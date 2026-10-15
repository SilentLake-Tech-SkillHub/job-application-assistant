"""Twenty explicitly authorized real-model runs: 5 sites x semantic cold/warm x 2 modes.

Ordinary CI never invokes this paid entry point. A warm local seed has no model calls;
its actual duration is retained inside full CLI wall time and also reported separately.
"""
import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path
from full_chain_benchmark import (ROOT, BASELINE, OPTIMIZATION_BEFORE, DEFAULT_CODEX, DEFAULT_REA,
                                 stage_runtime, run_round, runtime_environment)
from fixtures.form_sites import SITES


def cells():
    result = []
    for i, site in enumerate(SITES):
        for j, state in enumerate(('cold', 'warm')):
            modes = ('baseline', 'optimized') if (i + j) % 2 == 0 else ('optimized', 'baseline')
            result.extend({'site': site, 'cache_state': state, 'mode': mode,
                           'case_id': site + '-' + state + '-' + mode} for mode in modes)
    return result


def prompt(mode, site, state):
    common = '''For every code-mode exec returning instructions or tool results, put exactly this on its first line:
// @exec: {"max_output_tokens": 50000}
Return complete instruction text, never summarize or truncate it. Recover missing text before actions.
Run ONE complete synthetic application for ONLY SITE_ID, using only formbench MCP tools.
This is an explicitly approved, single-site benchmark with a fresh model context and CACHE_STATE semantic-cache condition.
Cold/warm refer to semantic structure cache, not model prompt caching. Warm native-only cache preparation is
local, contains no model decisions/widget recipes, and does not reuse a filled form or prior readback plan.
Do not operate any other site. The staged batch contract contains the confirmed synthetic role, JD,
eligibility/order/quota, approved resume and privacy-field authorization. Exact-version mock user approval
is explicitly simulated by the review tool; do not request duplicate confirmation.
Load complete required Skill/reference/profile instructions. Choose exact approved facts and real visible
widget options. Never use shell, patching, other agents, external sites, internal APIs or JavaScript mutation.
Upload the approved resume before other fields; rescan current DOM after parsing. Every field must pass
actual current readback, saved server draft validation, exact review approval/Submit gate, real mock UI
submission, independent server receipt and Excel tracker readback. Keep all failures/retries in the run.
Finally call finish_batch for this ONE site only; give a brief receipt result. Do not claim success early.
'''.replace('SITE_ID', site).replace('CACHE_STATE', state)
    if mode == 'optimized':
        return common + '''Discover the formbench catalog once and reuse it. Call bootstrap once: all required staged
instructions/profile facts are loaded together. Call prepare_forms with the one selected site: the shipping
program observes/maps/fills native fields/readbacks and handles bounded upload rescans. Do not refill
verified fields. Only remaining exceptions require your decisions. Inspect real widgets through
inspect_widgets, then use complete_fields with exact current locator recipes and scalar readback locators.
Use diagnose_bindings only after attempted real UI exploration or an observed failure leaves binding unknown;
successful controls need no REA. Once ready, call review_submit_batch for this one site, then finish_batch.
'''
    return common + '''Read SKILL.md, batch-contract and synthetic-profile, then references/stage-contract.md,
references/browser-application.md, skills/application-content-fill/SKILL.md and skills/privacy-info-fill/SKILL.md.
Baseline application mode does not expose REA or the automatic semantic mapper. Observe the full actual DOM,
select every field source yourself, and inspect real custom widget options using inspect_ui. configure_fill
executes your explicit source choices and real click paths. Upload-first rerender requires observe again.
After filling call review_submit; correct any validation failure, then finish_batch after the one verified receipt.
'''


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--model', default='gpt-5.6-sol')
    p.add_argument('--rea-entry', type=Path, default=DEFAULT_REA)
    p.add_argument('--codex-entry', type=Path, default=DEFAULT_CODEX)
    p.add_argument('--timeout', type=int, default=1800)
    p.add_argument('--resume', action='store_true', help='Resume unstarted cells only; never rerun/delete charged attempts')
    args = p.parse_args()
    args.private, args.report = args.private.resolve(), args.report.resolve()
    args.private.mkdir(parents=True, exist_ok=True); args.report.mkdir(parents=True, exist_ok=True)
    for entry in (args.rea_entry, args.codex_entry):
        if not entry.is_file():
            p.error('Missing installed entry: ' + str(entry))
    runtime = {'baseline': args.private / 'runtime-before', 'optimized': args.private / 'runtime-optimized'}
    adapter = args.private / 'runtime-adapter'
    if not args.resume:
        stage_runtime(runtime['baseline'], OPTIMIZATION_BEFORE)
        stage_runtime(runtime['optimized'])
        adapter.mkdir()
        for name in ('isolated_form_mcp.py', 'form_preparation.py'):
            shutil.copyfile(ROOT / 'scripts' / name, adapter / name)
    elif not all(p.is_dir() for p in (*runtime.values(), adapter)):
        p.error('Cannot resume without original immutable snapshots')
    report_path = args.report / 'results.json'
    report = json.loads(report_path.read_bytes()) if args.resume and report_path.exists() else {
        'protocol_version': 3, 'comparison': 'isolated-cold-warm-baseline-optimized',
        'baseline_skill_commit': BASELINE, 'before_executor_commit': OPTIMIZATION_BEFORE,
        'model': args.model, 'reasoning_effort': 'high', 'planned_cells': cells(), 'results': [],
        'scope': 'One fresh Codex context and owned application per cell; 20 serial model turns, not shared-token allocation',
        'warm_definition': 'Native automatic fields are actually filled/read back locally; verified semantic cache retained; seed page and filled plan discarded. No seed LLM calls or complex-widget recipe.',
        'baseline_warm_control': 'Identical local cache seed is available but baseline application cannot consume the semantic cache; a negative control.',
        'time_boundary': 'CLI process launch through full model turn and process exit, INCLUDING warm seed; seed duration separately measured, exclusion is derived not a second run.',
        'llm_cache': 'Provider prompt cache is not controlled by semantic cold/warm; actual cached input reported separately.',
        'lane': 'Existing Playwright backup executor; real model and conditional actual REA. IAB/Chrome full chain unmeasured.',
        'human_wait_measured': False, 'prerequisites': 'Confirmed synthetic JD/roles/eligibility/quota/profile; mock approval simulated; no real login/research/human wait',
        'draft_readback': 'Server GET and current UI field recheck, no browser reopen/restoration',
        'statistical_limit': 'One run per cell; no stable mean or significance claim',
        'adapter_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in adapter.glob('*.py')},
        'environment': runtime_environment(args)}
    if report['model'] != args.model:
        p.error('Resume must use the same model')
    start = time.perf_counter()
    completed_ids = {r['case_id'] for r in report['results']}
    for cell in cells():
        if cell['case_id'] in completed_ids:
            continue
        print('START ' + cell['case_id'], flush=True)
        context = {**cell, 'prompt': prompt(cell['mode'], cell['site'], cell['cache_state']),
                   'controller_entry': adapter / 'isolated_form_mcp.py',
                   'controller_extra': ['--runtime', str(runtime[cell['mode']]), '--site', cell['site'], '--cache-state', cell['cache_state']]}
        result = run_round(args, cell['mode'], args.private / (cell['site'] + '-' + cell['cache_state']), runtime[cell['mode']], context)
        result['case_id'] = cell['case_id']
        report['results'].append(result)
        report['runner_elapsed_seconds_current_invocation'] = time.perf_counter() - start
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('DONE ' + cell['case_id'] + ' ' + json.dumps({'completed': result['completed'], 'wall_seconds': result['wall_seconds'], 'usage': result['usage'], 'delivery': result['complete_delivery_valid']}), flush=True)
        if not result['completed'] or not result['complete_delivery_valid']:
            print('Stopped on failed/incomplete cell; charged usage preserved. Repair before starting more cells.', flush=True)
            return 1
    return 0 if len(report['results']) == 20 and all(r['completed'] and r['complete_delivery_valid'] for r in report['results']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
