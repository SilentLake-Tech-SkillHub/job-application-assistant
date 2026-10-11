#!/usr/bin/env python3
"""Smoke test: every shipped command starts, accepts a valid ledger and rejects a bad one.

Fast (seconds), no browser. Run after install or copy to confirm the package is usable.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
ENV = dict(os.environ, PYTHONIOENCODING='utf-8')


def run(*args):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, encoding='utf-8', env=ENV, cwd=HERE)


def main():
    from test_validate_batch import fixture
    from openpyxl import Workbook
    checks = []

    def expect(name, result, code):
        ok = result.returncode == code
        checks.append({'check': name, 'ok': ok, 'exit': result.returncode})
        if not ok:
            print(result.stdout[-1500:], result.stderr[-1500:], file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        good = tmp / 'batch.json'; good.write_text(json.dumps(fixture(), ensure_ascii=False), encoding='utf-8')
        bad = tmp / 'bad.json'; bad.write_text('{"batch": {}}', encoding='utf-8')
        for script in ('validate_batch.py', 'stage_gate.py', 'tracker_readback.py'):
            expect(script + ' --help', run(HERE / script, '--help'), 0)
        expect('validate good ledger', run(HERE / 'validate_batch.py', good), 0)
        expect('validate bad ledger', run(HERE / 'validate_batch.py', bad), 1)
        expect('gate query', run(HERE / 'stage_gate.py', good, '--stage', 'query'), 0)
        expect('gate prepare', run(HERE / 'stage_gate.py', good, '--stage', 'prepare', '--role', 'alpha:id:1'), 0)
        expect('gate submit blocked', run(HERE / 'stage_gate.py', good, '--stage', 'submit', '--role', 'alpha:id:1'), 1)
        book, backup = tmp / 't.xlsx', tmp / 't.bak.xlsx'
        wb = Workbook(); ws = wb.active; ws.title = 'S'; ws.append(['url', 'status']); ws.append(['u1', 'pending']); wb.save(backup)
        ws['B2'] = 'submitted'; wb.save(book)
        import hashlib
        expect_file = tmp / 'expect.json'; expect_file.write_text('[{"key": "u1", "fields": {"status": "submitted"}}]', encoding='utf-8')
        expect('tracker readback', run(HERE / 'tracker_readback.py', '--workbook', book, '--backup', backup,
                                       '--pre-sha256', hashlib.sha256(backup.read_bytes()).hexdigest(),
                                       '--sheet', 'S', '--key-column', 'url', '--expect', expect_file), 0)
        copy = tmp / 'package'
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns('.git', '__pycache__', 'node_modules'))
        expect('package check on a fresh copy', run(copy / 'docs' / 'validation' / 'check_package.py', copy), 0)
        expect('node syntax inspect_form_controls.js', subprocess.run(['node', '--check', str(HERE / 'inspect_form_controls.js')],
                                                                       capture_output=True, text=True), 0) if shutil.which('node') else None
    passed = all(c['ok'] for c in checks)
    print(json.dumps({'smoke_passed': passed, 'checks': checks}, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
