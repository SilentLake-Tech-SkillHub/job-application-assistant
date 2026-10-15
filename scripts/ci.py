#!/usr/bin/env python3
"""Single CI entry point: static → unit → smoke → browser/full-flow → stress.

  python3 scripts/ci.py                 # everything
  python3 scripts/ci.py --skip-browser  # no Chromium available
  python3 scripts/ci.py --only unit     # one stage

Exit 0 only when every selected stage passes. Browser stages need Playwright for Python and
Node plus a Chromium/Chrome (CHROME_EXECUTABLE overrides the browser path).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1')

UNIT = ['test_batch_check.py', 'test_fill_plan.py', 'test_profile_vault.py', 'test_docs_consistency.py', 'test_tracker_readback.py', 'test_hooks.py', 'test_rea_bridge.py', 'test_token_metrics.py', 'test_full_chain_benchmark.py', 'test_form_preparation.py', 'test_isolated_form_benchmark.py', 'test_rea_reuse.py', 'test_browser_session.py']


def node_env():
    env = dict(ENV)
    if 'NODE_PATH' not in env and shutil.which('npm'):
        roots = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True, shell=os.name == 'nt').stdout.strip()
        env['NODE_PATH'] = roots
    return env


def stages(skip_browser):
    py = sys.executable
    plan = {
        'static': [[py, str(ROOT / 'docs' / 'validation' / 'check_package.py'), str(ROOT)],
                   [py, '-m', 'py_compile', *[str(p) for p in [*HERE.glob('*.py'), *(HERE / 'fixtures').glob('*.py'), *(ROOT / 'hooks').glob('*.py'), *ROOT.glob('skills/*/scripts/*.py')]]]],
        'unit': [[py, str(HERE / t)] for t in UNIT],
        'smoke': [[py, str(HERE / 'smoke_test.py')]],
        'browser': [['node', str(HERE / 'test_inspect_form_controls.cjs')],
                    ['node', str(HERE / 'test_field_binding_recovery.cjs')],
                    [py, str(HERE / 'test_playwright_fill.py')],
                    [py, str(HERE / 'test_e2e_full_flow.py')],
                    [py, str(HERE / 'test_form_automation.py')],
                    [py, str(HERE / 'test_full_chain_benchmark.py'), '--browser'],
                    [py, str(HERE / 'test_form_preparation.py'), '--browser'],
                    [py, str(HERE / 'test_isolated_form_benchmark.py'), '--browser'],
                    [py, str(HERE / 'test_rea_reuse.py'), '--browser'],
                    [py, str(HERE / 'test_compile_rea_rule.py')]],
        'stress': [[py, str(HERE / 'test_stress.py')]],
    }
    if shutil.which('node'):
        for script in [*HERE.glob('*.cjs'), HERE / 'inspect_form_controls.js', *(HERE / 'vendor').glob('*.cjs')]:
            plan['static'].append(['node', '--check', str(script)])
        plan['unit'].append(['node', str(HERE / 'test_form_semantics.cjs')])
    if skip_browser:
        plan.pop('browser')
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--skip-browser', action='store_true')
    parser.add_argument('--only', choices=['static', 'unit', 'smoke', 'browser', 'stress'])
    parser.add_argument('--report', type=Path, help='Write the complete selected-check summary as JSON')
    args = parser.parse_args()
    plan = stages(args.skip_browser)
    if args.only:
        plan = {args.only: plan[args.only]}
    summary, ok = [], True
    for stage, commands in plan.items():
        for command in commands:
            start = time.perf_counter()
            env = node_env() if command[0] == 'node' else ENV
            result = subprocess.run(command, cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
            passed = result.returncode == 0
            ok = ok and passed
            name = Path(command[1]).name if len(command) > 1 else command[0]
            if command[1:2] == ['-m']:
                name = 'py_compile'
            elif command[1:2] == ['--check']:
                name = 'node --check'
            summary.append({'stage': stage, 'check': name, 'passed': passed, 'seconds': round(time.perf_counter() - start, 2)})
            print(('PASS ' if passed else 'FAIL ') + stage + ' · ' + name, flush=True)
            if not passed:
                print((result.stdout + result.stderr)[-4000:], flush=True)
    report = {'ci_passed': ok, 'results': summary}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
