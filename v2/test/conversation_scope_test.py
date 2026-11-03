import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import importlib.util

spec = importlib.util.spec_from_file_location('scope_under_test', Path(__file__).resolve().parents[1] / 'hooks/conversation_scope.py')
scope_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope_module)

SCRIPT = Path(__file__).resolve().parents[1] / 'hooks/conversation_scope.py'


class ConversationScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.scope = self.root / 'scope.json'
        self.policy = self.root / 'policy.md'
        self.policy.write_text('Synthetic accepted workflow')

    def tearDown(self):
        self.tmp.cleanup()

    def run_scope(self, session, operation='enable', extra_env=None):
        base = {k: v for k, v in os.environ.items()
                if k not in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'DSH_SESSION_ID', 'RECRUITING_HOST_ROLE')}
        env = {**base, 'CODEX_THREAD_ID': session, 'CODEX_SESSION_ID': session, **(extra_env or {})}
        return subprocess.run([sys.executable, str(SCRIPT), operation, '--scope-file', str(self.scope),
                               '--policy-file', str(self.policy), '--authorization-ref', 'synthetic user request'],
                              env=env, capture_output=True, text=True)

    def test_enable_only_current_conversation(self):
        self.assertEqual(self.run_scope('conversation-a').returncode, 0)
        self.assertEqual(json.loads(self.scope.read_text())['session_ids'], ['conversation-a'])

    def test_independent_enable_and_disable_preserve_other_conversation(self):
        self.run_scope('conversation-a');self.run_scope('conversation-b')
        self.assertEqual(self.run_scope('conversation-a', 'disable').returncode, 0)
        d = json.loads(self.scope.read_text())
        self.assertEqual(d['session_ids'], ['conversation-b'])
        self.assertNotIn('conversation-a', d['sessions'])

    def test_fork_not_implicitly_enabled(self):
        self.run_scope('parent')
        self.assertNotIn('fork', json.loads(self.scope.read_text())['session_ids'])

    def test_missing_or_conflicting_host_identity_rejects_without_write(self):
        for env in [{'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': ''},
                    {'CODEX_THREAD_ID': 'a', 'CODEX_SESSION_ID': 'b'}]:
            r = self.run_scope('ignored', extra_env=env)
            self.assertEqual(r.returncode, 2)
            self.assertFalse(self.scope.exists())

    def test_dsh_session_identity_enables_only_that_conversation(self):
        r = self.run_scope('', extra_env={'CODEX_THREAD_ID': '', 'CODEX_SESSION_ID': '',
                                          'DSH_SESSION_ID': 'dsh-conversation'})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(self.scope.read_text())['session_ids'], ['dsh-conversation'])

    def test_maintainer_host_cannot_enable_execution_but_can_disable(self):
        r = self.run_scope('maintainer-thread', extra_env={'RECRUITING_HOST_ROLE': 'maintainer'})
        self.assertEqual(r.returncode, 2)
        self.assertIn('HOST_ROLE_MAINTAINER_CANNOT_ENABLE_EXECUTION', r.stderr)
        self.assertFalse(self.scope.exists())
        self.run_scope('maintainer-thread')
        r = self.run_scope('maintainer-thread', 'disable', extra_env={'RECRUITING_HOST_ROLE': 'maintainer'})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(self.scope.read_text())['session_ids'], [])

    def test_invalid_role_cannot_register_an_execution_session(self):
        result = self.run_scope('current', extra_env={'RECRUITING_HOST_ROLE': 'unknown'})
        self.assertEqual(result.returncode, 2)
        self.assertIn('INVALID_RECRUITING_HOST_ROLE', result.stderr)
        self.assertFalse(self.scope.exists())

    def test_registration_expires_after_twelve_hours_and_read_prunes_it(self):
        self.run_scope('current')
        data = json.loads(self.scope.read_text())
        record = data['sessions']['current']
        self.assertEqual(record['expiresAt'] - record['registeredAt'], 12 * 3600)
        active = scope_module.read_active_scope(self.scope, now=record['expiresAt'])
        self.assertEqual(active['session_ids'], [])
        self.assertEqual(json.loads(self.scope.read_text())['sessions'], {})

    def test_expiry_does_not_slide_when_hook_reads_or_enable_is_repeated(self):
        self.run_scope('current')
        original = json.loads(self.scope.read_text())['sessions']['current']
        self.run_scope('current')
        self.assertEqual(json.loads(self.scope.read_text())['sessions']['current'], original)
        scope_module.read_active_scope(self.scope, now=original['registeredAt'] + 100)
        self.assertEqual(json.loads(self.scope.read_text())['sessions']['current'], original)

    def test_legacy_registration_never_becomes_permanent(self):
        self.scope.write_text(json.dumps({'session_ids': ['old'], 'sessions': {'old': {}}}))
        self.assertEqual(scope_module.read_active_scope(self.scope, now=100)['session_ids'], [])

    def test_explicit_disable_targets_only_requested_old_registration(self):
        self.run_scope('old'); self.run_scope('active')
        env = {k: v for k, v in os.environ.items() if k not in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'DSH_SESSION_ID')}
        env['CODEX_THREAD_ID'] = 'maintenance'
        result = subprocess.run([sys.executable, str(SCRIPT), 'disable', '--scope-file', str(self.scope),
                                 '--target-session', 'old', '--authorization-ref', 'explicit cleanup request'],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.scope.read_text())['session_ids'], ['active'])


if __name__ == '__main__':
    unittest.main()
