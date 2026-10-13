#!/usr/bin/env python3
"""Smoke test: every shipped command starts and gives the expected verdict on a synthetic workspace.

Fast (seconds), no browser. Run after install or copy to confirm the package is usable.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE / 'fixtures'))
from workspace import Workspace  # noqa: E402

URL = 'https://example.test/jobs/101'


def run(*args, stdin=None):
    import os
    return subprocess.run([sys.executable, *map(str, args)], input=stdin, capture_output=True, text=True,
                          encoding='utf-8', env=dict(os.environ, PYTHONIOENCODING='utf-8'), cwd=HERE)


def main():
    checks = []

    def expect(name, result, code):
        ok = result.returncode == code
        checks.append({'检查': name, '通过': ok, '退出码': result.returncode})
        if not ok:
            print(result.stdout[-1500:], result.stderr[-1500:], file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        w = Workspace(tmp)
        book = ['--workbook', w.book, '--batch', 'b1']
        for script in ('batch_check.py', 'stage_gate.py', 'tracker_readback.py', '../hooks/install_hooks.py',
                       '../skills/application-parallel-execution/scripts/validate_assignments.py'):
            expect(script + ' --help', run(HERE / script, '--help'), 0)
        expect('batch check on fresh workspace', run(HERE / 'batch_check.py', *book), 0)
        expect('query gate', run(HERE / 'stage_gate.py', *book, '--stage', 'query'), 0)
        w.tag('合成公司A', '已有相关岗位记录'); w.add_role('合成公司A', URL)
        expect('prepare gate blocks without evidence', run(HERE / 'stage_gate.py', *book, '--stage', 'prepare', '--url', URL), 1)
        w.company_ready('合成公司A'); w.role_prepared('合成公司A', URL)
        expect('prepare gate allows with evidence', run(HERE / 'stage_gate.py', *book, '--stage', 'prepare', '--url', URL), 0)
        expect('submit gate blocks without approval', run(HERE / 'stage_gate.py', *book, '--stage', 'submit', '--url', URL), 1)
        w.role_approved('合成公司A', URL)
        expect('submit gate allows and issues pass', run(HERE / 'stage_gate.py', *book, '--stage', 'submit', '--url', URL), 0)
        hook = json.dumps({'hook_event_name': 'PreToolUse', 'cwd': tmp, 'tool_name': 'mcp__x__computer',
                           'tool_input': {'action': 'left_click', 'action_summary': '点击“提交申请”'}}, ensure_ascii=False)
        expect('hook allows with pass', run(ROOT / 'hooks' / 'application_guard.py', stdin=hook), 0)
        expect('hook ignores empty input', run(ROOT / 'hooks' / 'application_guard.py', stdin=''), 0)
        backup = Path(tmp) / 'bak.xlsx'; shutil.copy(w.book, backup)
        pre = hashlib.sha256(backup.read_bytes()).hexdigest()
        w.set_apply_status(URL, '已提交')
        expect('tracker readback', run(HERE / 'tracker_readback.py', '--workbook', w.book, '--backup', backup, '--pre-sha256', pre,
                                       '--expect', '中国大陆|岗位链接|' + URL + '|投递状态=已提交'), 0)
        expect('closeout blocked while work remains', run(HERE / 'stage_gate.py', *book, '--stage', 'closeout'), 1)
        copy = Path(tmp) / 'package'
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns('.git', '__pycache__', 'node_modules'))
        expect('package check on a fresh copy', run(copy / 'docs' / 'validation' / 'check_package.py', copy), 0)
        if shutil.which('node'):
            expect('node syntax inspect_form_controls.js',
                   subprocess.run(['node', '--check', str(HERE / 'inspect_form_controls.js')], capture_output=True, text=True), 0)
    passed = all(c['通过'] for c in checks)
    print(json.dumps({'冒烟通过': passed, '检查': checks}, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
