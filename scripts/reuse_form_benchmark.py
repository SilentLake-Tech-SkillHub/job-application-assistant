"""Explicitly authorized 15-turn REA learning/reuse experiment; never run paid AI in CI."""
import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path
from full_chain_benchmark import ROOT, DEFAULT_REA, DEFAULT_CODEX, stage_runtime, run_round, runtime_environment
from fixtures.form_sites import SITES

ARMS = ('no-rea', 'first-rea', 'reuse')
SOURCE_REF = 'cef98f72d25c7584eb106a0dde719147c4013b92'
OVERLAY = ['scripts/rea_rule_store.py', 'scripts/reuse_form_mcp.py', 'scripts/test_rea_reuse.py',
           'references/rea-rule-reuse.md', 'references/semantic-form-automation.md']


def cells():
    result = []
    for i, site in enumerate(SITES):
        order = ARMS if i % 2 == 0 else ('first-rea', 'reuse', 'no-rea')
        result.extend({'site': site, 'arm': arm, 'case_id': site + '-' + arm} for arm in order)
    return result


def prompt(site, arm):
    return '''For every code-mode exec returning tool output/instructions, use exactly this first line:
// @exec: {"max_output_tokens": 50000}
Return complete instruction text, never summarize or truncate it; recover missing text before actions.
Run ONE explicitly approved complete synthetic application for ONLY SITE using only formbench MCP tools.
Do not use shell, patching, other agents, external websites, JS mutation or internal application APIs.
Discover the catalog once, reuse names, call bootstrap once; it loads the complete staged Skill, relevant
references and current synthetic approved profile/batch together. Use CURRENT profile facts; never invent.
Query, synthetic JD/eligibility/order/quota/material/privacy authority are confirmed. Mock-user exact-version
approval is explicitly simulated by the review tool. Do not ask duplicate confirmation.
Experiment arm: ARM. All three arms retain the same optimized preparation and review/submit gates.
For first-rea ONLY: call analyze_form before prepare_forms, including native forms. This explicit learning
experiment measures one real REA analysis plus validation/storage; production does NOT require routine REA.
Interpret captured binding evidence. The actual complete field recipes are replayed on a FRESH BLANK page
before promotion, so complex recipes must contain the whole click path from closed menus, including all
cascade levels and the current scalar readback locator. No fixture recipe is supplied.
For reuse: prepare_forms attempts the previous first-rea verified rule with CURRENT facts on a NEW page;
no old model context, filled plan, applicant values, approval or receipt is inherited. Readback is mandatory.
For no-rea: REA and REA-derived rules are disabled; ordinary optimized preparation is identical.
Call prepare_forms for this one site. Upload the approved resume FIRST ONLY IF this form has an upload
field; the program handles upload rescans. Do not probe files on forms without upload controls.
If ready_for_review is true, do not inspect or complete fields again. Otherwise inspect real visible menus
with inspect_widgets and complete_fields for only pending fields, choosing exact current facts/options.
For any complex exception give the full closed-state click recipe; do not rely on a menu left half open
by exploration. Use analyze_form/diagnose_bindings only when permitted. Keep ALL errors/retries in the run.
After all fields pass current readback call review_submit_batch for this site. It validates persisted server
draft/current UI, current review hash and exact approval/Submit gate, actual mock UI submission, independent
server receipt and Excel tracker. Correct any rejection; never claim success from a button click alone.
Finally call finish_batch for this ONE site and give a brief receipt result.
'''.replace('ONLY SITE', 'ONLY ' + site).replace('arm: ARM', 'arm: ' + arm)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private', type=Path, required=True); p.add_argument('--report', type=Path, required=True)
    p.add_argument('--model', default='gpt-5.6-sol')
    p.add_argument('--rea-entry', type=Path, default=DEFAULT_REA)
    p.add_argument('--codex-entry', type=Path, default=DEFAULT_CODEX)
    p.add_argument('--timeout', type=int, default=1800); p.add_argument('--resume', action='store_true')
    args = p.parse_args()
    args.private, args.report = args.private.resolve(), args.report.resolve()
    args.private.mkdir(parents=True, exist_ok=True); args.report.mkdir(parents=True, exist_ok=True)
    runtime = args.private / 'runtime'
    report_path = args.report / 'results.json'
    if not args.resume:
        stage_runtime(runtime, SOURCE_REF)  # Exclude other chats' uncommitted files.
        for name in OVERLAY:
            shutil.copyfile(ROOT / name, runtime / name)
        report = {'protocol_version': 4, 'comparison': 'optimized-no-rea-first-learning-reuse',
            'model': args.model, 'reasoning_effort': 'high', 'planned_cells': cells(), 'results': [],
            'source_ref': SOURCE_REF,
            'overlay_sha256': {n: hashlib.sha256((runtime / n).read_bytes()).hexdigest() for n in OVERLAY},
            'baseline': 'SAME optimized workflow, REA/derived rule disabled; not historical original workflow',
            'learning': 'Actual first REA capture, model interpretation, native/custom discovery, fresh-page recipe replay, draft verification and promotion included',
            'reuse': 'New CLI/context/browser/workspace; only the actual corresponding learning rule file is available; no local seed or prior messages',
            'profiles': 'No-REA and reuse have identical changed synthetic profile. Learning has original synthetic facts. School/date option values and DOM IDs change for reuse; structure/field count remain the same.',
            'time_boundary': 'CLI process launch through full turn and process exit, all REA/storage/replay/retries/gates included',
            'llm_cache': 'Provider prompt cache uncontrolled; actual input/cached-input/output recorded, no pricing inference',
            'scope': 'Single-site owned mock confirmed-role cycle, shipping Playwright backup. Human approval simulated; research/login/CAPTCHA/wait/IAB/Chrome full chain not measured',
            'statistical_limit': 'One observation per site/arm; cumulative reuse projections are arithmetic, not additional measured runs',
            'environment': runtime_environment(args)}
    else:
        report = json.loads(report_path.read_bytes())
        if report['model'] != args.model or any(hashlib.sha256((runtime / n).read_bytes()).hexdigest() != sha for n, sha in report['overlay_sha256'].items()):
            p.error('Resume requires unchanged original runtime/model')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    done = {r['case_id'] for r in report['results']}
    for cell in cells():
        if cell['case_id'] in done:
            continue
        site, arm = cell['site'], cell['arm']
        if arm == 'reuse':
            learned = next((r for r in report['results'] if r['site'] == site and r['arm'] == 'first-rea'), None)
            if not learned or not learned['completed']:
                raise ValueError('Reuse requires successful actual first-learning result')
        rule_dir = args.private / 'rule-stores' / site / ('no-rea-empty' if arm == 'no-rea' else 'learned')
        extras = ['--runtime', str(runtime), '--site', site, '--experiment', arm, '--rule-dir', str(rule_dir),
                  '--variant', str(0 if arm == 'first-rea' else 1)]
        context = {'site': site, 'cache_state': arm, 'prompt': prompt(site, arm),
                   'controller_entry': runtime / 'scripts/reuse_form_mcp.py', 'controller_extra': extras}
        print('START ' + cell['case_id'], flush=True)
        result = run_round(args, 'optimized', args.private / cell['case_id'], runtime, context)
        result.update(cell)
        report['results'].append(result)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('DONE ' + cell['case_id'] + ' ' + json.dumps({'completed': result['completed'], 'seconds': result['wall_seconds'], 'usage': result['usage']}), flush=True)
        if not result['completed'] or not result['complete_delivery_valid']:
            print('Stopped; charged attempt retained. Do not delete or silently resample.', flush=True)
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
