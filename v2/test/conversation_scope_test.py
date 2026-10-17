import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

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
        env = {**os.environ, 'CODEX_THREAD_ID': session, 'CODEX_SESSION_ID': session, **(extra_env or {})}
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


if __name__ == '__main__':
    unittest.main()
