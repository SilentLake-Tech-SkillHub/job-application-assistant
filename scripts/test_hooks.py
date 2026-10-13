#!/usr/bin/env python3
"""Submit guard hook, submit pass, installer and strict evidence (synthetic workspaces only)."""
import datetime
import re
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
GUARD = HERE.parent / 'hooks' / 'application_guard.py'
INSTALL = HERE.parent / 'hooks' / 'install_hooks.py'
sys.path.insert(0, str(GUARD.parent))

import application_guard as guard  # noqa: E402
from submit_pass import issue_submit_pass, consume_submit_click, pass_path  # noqa: E402
from batch_check import find_root  # noqa: E402

ENV = dict(os.environ, PYTHONIOENCODING='utf-8')

# Tool-call shapes seen on each platform (names and fields as the hook receives them).
SUBMIT_CALLS = [
    ('mcp__claude-in-chrome__computer', {'action': 'left_click', 'ref': 'ref_12', 'action_summary': 'Submits the application for 合成AI产品经理'}),
    ('mcp__Claude_Browser__computer', {'action': 'left_click', 'coordinate': [400, 300], 'action_summary': '点击“提交申请”按钮'}),
    ('mcp__remote-devices__Claude_Browser__computer', {'action': 'left_click', 'action_summary': '点击弹窗里的“确认投递”'}),
    ('mcp__playwright__browser_click', {'element': '提交申请 button', 'ref': 'e42'}),
    ('mcp__claude-in-chrome__browser_batch', {'actions': [{'name': 'computer', 'input': {'action': 'left_click', 'action_summary': 'Opens the review tab'}},
                                                          {'name': 'computer', 'input': {'action': 'left_click', 'action_summary': '点击“投递简历”'}}]}),
    ('mcp__claude-in-chrome__computer', {'action': 'key', 'text': 'Enter', 'action_summary': 'Submits the form with Enter'}),
    ('', {'action': 'left_click', 'action_summary': '点击“我已知晓（投递后不可修改）”'}),
]
SAFE_CALLS = [
    ('mcp__claude-in-chrome__computer', {'action': 'left_click', 'action_summary': '点击“保存草稿”'}),
    ('mcp__claude-in-chrome__computer', {'action': 'left_click', 'action_summary': '打开申请中心查看投递记录'}),
    ('mcp__claude-in-chrome__navigate', {'url': 'https://example.test/apply/1'}),
    ('mcp__claude-in-chrome__read_page', {'filter': '提交申请'}),
    ('mcp__claude-in-chrome__computer', {'action': 'type', 'text': '项目经历：负责提交流程优化'}),
    ('Bash', {'command': 'echo submit'}),
    ('mcp__playwright__browser_click', {'element': '下一步 button', 'ref': 'e7'}),
]


def payload(tool_name, tool_input, cwd, event='PreToolUse'):
    return json.dumps({'hook_event_name': event, 'session_id': 's', 'cwd': str(cwd), 'tool_name': tool_name,
                       'tool_input': tool_input}, ensure_ascii=False)


def run_guard(text):
    return subprocess.run([sys.executable, str(GUARD)], input=text.encode('utf-8'), capture_output=True, env=ENV)


class ClassificationTests(unittest.TestCase):
    def test_submit_like_calls_are_recognized(self):
        for name, data in SUBMIT_CALLS:
            self.assertTrue(guard.submit_like(name, data), (name, data))

    def test_safe_calls_are_not_submissions(self):
        for name, data in SAFE_CALLS:
            self.assertFalse(guard.submit_like(name, data), (name, data))


class GuardProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / '投递根目录'
        (self.root / '投递证据').mkdir(parents=True)
        self.cwd = self.root / 'sub'; self.cwd.mkdir()
        self.folder = self.root / '投递证据' / 'b1' / '岗位' / '合成公司A-0ac9f2ea'
        self.folder.mkdir(parents=True)

        self.click = payload(*SUBMIT_CALLS[1], self.cwd)

    def issue(self, clicks=3):
        return issue_submit_pass(self.root, 'b1', 'https://example.test/jobs/101', self.folder, clicks=clicks)

    def tearDown(self):
        self.tmp.cleanup()

    def test_outside_application_workspace_is_untouched(self):
        outside = Path(self.tmp.name) / 'other'; outside.mkdir()
        self.assertEqual(run_guard(payload(*SUBMIT_CALLS[0], outside)).returncode, 0)

    def test_submit_without_pass_is_blocked_with_reason(self):
        result = run_guard(self.click)
        self.assertEqual(result.returncode, 2)
        self.assertIn('stage_gate.py', result.stderr.decode('utf-8'))
        self.assertIn('已拦截', result.stderr.decode('utf-8'))

    def test_pass_allows_three_clicks_then_blocks(self):
        info = self.issue()
        self.assertEqual(info['点击次数'], 3)
        for _ in range(3):
            self.assertEqual(run_guard(self.click).returncode, 0)
        self.assertEqual(run_guard(self.click).returncode, 2)

    def test_expired_pass_is_blocked(self):
        self.issue()
        text = pass_path(self.root).read_text(encoding='utf-8')
        past = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)).isoformat()
        pass_path(self.root).write_text(re.sub(r'到期: .*', '到期: ' + past, text), encoding='utf-8')
        result = run_guard(self.click)
        self.assertEqual(result.returncode, 2)
        self.assertIn('expired', result.stderr.decode('utf-8'))

    def test_corrupt_pass_fails_closed(self):
        pass_path(self.root).write_text('# 提交通行证\n到期: 不是时间\n', encoding='utf-8')
        self.assertEqual(run_guard(self.click).returncode, 2)

    def test_safe_calls_and_other_events_pass(self):
        for name, data in SAFE_CALLS:
            self.assertEqual(run_guard(payload(name, data, self.cwd)).returncode, 0, name)
        self.assertEqual(run_guard(payload(*SUBMIT_CALLS[0], self.cwd, event='PostToolUse')).returncode, 0)
        self.assertEqual(run_guard('not json').returncode, 0)
        self.assertEqual(run_guard('').returncode, 0)

    def test_kimi_style_payload_without_tool_name(self):
        text = json.dumps({'hook_event_name': 'PreToolUse', 'session_id': 's', 'session_title': 't', 'client_type': 'cli',
                           'cwd': str(self.cwd), 'tool_input': SUBMIT_CALLS[2][1]}, ensure_ascii=False)
        self.assertEqual(run_guard(text).returncode, 2)

    def test_pass_void_once_receipt_or_uncertain_recorded(self):
        for marker in ('回执.png', '结果不确定.md'):
            for p in self.folder.iterdir():
                p.unlink()
            self.issue()
            self.assertEqual(run_guard(self.click).returncode, 0)
            (self.folder / marker).write_text('x', encoding='utf-8')
            result = run_guard(self.click)
            self.assertEqual(result.returncode, 2, marker)
            self.assertIn('void', result.stderr.decode('utf-8'))
        self.folder.rename(self.folder.with_name('moved'))
        self.assertEqual(run_guard(self.click).returncode, 2)  # missing role folder fails closed

    def test_direct_consume_api(self):
        self.assertEqual(consume_submit_click(self.root)[0], False)
        self.issue(clicks=1)
        self.assertTrue(consume_submit_click(self.root)[0])
        self.assertFalse(consume_submit_click(self.root)[0])


class InstallerTests(unittest.TestCase):
    def run_install(self, platform, project, write, home):
        args = [sys.executable, str(INSTALL), '--platform', platform, '--project', str(project)] + (['--write'] if write else [])
        env = dict(ENV, HOME=str(home), USERPROFILE=str(home))
        return subprocess.run(args, capture_output=True, text=True, encoding='utf-8', env=env)

    def test_install_each_platform_idempotently(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, home = Path(tmp, 'p'), Path(tmp, 'home')
            (project / '投递证据').mkdir(parents=True); home.mkdir()
            dry = self.run_install('claude-code', project, False, home)
            self.assertEqual(dry.returncode, 0); self.assertFalse((project / '.claude').exists())
            for _ in range(2):
                for platform in ('claude-code', 'codex', 'kimi'):
                    self.assertEqual(self.run_install(platform, project, True, home).returncode, 0)
            settings = json.loads((project / '.claude' / 'settings.json').read_text(encoding='utf-8'))
            groups = settings['hooks']['PreToolUse']
            self.assertEqual(len(groups), 1); self.assertEqual(groups[0]['matcher'], 'mcp__.*')
            self.assertIn('application_guard.py', groups[0]['hooks'][0]['command'])
            codex = (project / '.codex' / 'config.toml').read_text(encoding='utf-8')
            kimi = (home / '.kimi-code' / 'config.toml').read_text(encoding='utf-8')
            self.assertEqual(codex.count('[[hooks.PreToolUse]]'), 1)
            self.assertEqual(kimi.count('[[hooks]]'), 1)
            if sys.version_info >= (3, 11):
                import tomllib
                parsed = tomllib.loads(codex)
                self.assertEqual(parsed['hooks']['PreToolUse'][0]['hooks'][0]['type'], 'command')
                self.assertEqual(tomllib.loads(kimi)['hooks'][0]['event'], 'PreToolUse')

    def test_installer_keeps_existing_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / '.claude').mkdir()
            (project / '.claude' / 'settings.json').write_text(json.dumps({'model': 'x', 'hooks': {'PreToolUse': [
                {'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'other-hook'}]}]}}), encoding='utf-8')
            self.assertEqual(self.run_install('claude-code', project, True, project).returncode, 0)
            settings = json.loads((project / '.claude' / 'settings.json').read_text(encoding='utf-8'))
            self.assertEqual(settings['model'], 'x')
            self.assertEqual(len(settings['hooks']['PreToolUse']), 2)


class RootDiscoveryTests(unittest.TestCase):
    def test_root_is_nearest_folder_with_evidence_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / '投递根目录'
            (root / '投递证据' / 'b1').mkdir(parents=True)
            book = root / '岗位追踪表.xlsx'; book.write_bytes(b'x')
            self.assertEqual(find_root(book), root.resolve())
            self.assertEqual(find_root(root / '投递证据' / 'b1'), root.resolve())
            self.assertIsNone(find_root(Path(tmp)))

if __name__ == '__main__':
    unittest.main()
