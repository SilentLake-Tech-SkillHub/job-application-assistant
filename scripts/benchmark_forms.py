#!/usr/bin/env python3
"""Paired mock baseline/enhanced benchmark, with cold/warm strata and raw transcripts.

No model API is invoked. Actual provider usage stays null unless supplied with --usage-json.
Timing measures real local scripts + UI + server persistence/receipt, excluding browser startup,
navigation and simulated Agent thinking. Comparisons use the existing batch workflow as baseline.
"""
import argparse
import csv
import hashlib
import json
import platform
import statistics
import subprocess
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from importlib.metadata import version
from playwright.sync_api import sync_playwright
from fixtures.form_sites import serve, SITES
from form_test_support import chrome_path, execute_case
from token_metrics import count_messages, load_usage


def summarize(rows):
    out = []
    for site in SITES:
        for state in ('cold', 'warm'):
            for mode in ('baseline', 'enhanced'):
                cases = [r for r in rows if r['site'] == site and r['cache_state'] == state and r['mode'] == mode]
                if not cases:
                    continue
                times = sorted(r['total_seconds'] for r in cases)
                out.append({'site': site, 'cache_state': state, 'mode': mode, 'cases': len(cases),
                            'median_seconds': statistics.median(times), 'min_seconds': times[0], 'max_seconds': times[-1],
                            'median_text_tokens': statistics.median(r['tokens']['total_text_tokens'] for r in cases),
                            'receipt_success_rate': sum(r['receipt_verified'] for r in cases) / len(cases)})
    return out


def run(runs, out, usage_path=None):
    out.mkdir(parents=True, exist_ok=True)
    transcript_dir = out / 'transcripts'; transcript_dir.mkdir(exist_ok=True)
    usage = load_usage(usage_path) if usage_path else {}
    server, _, base = serve()
    rows = []
    try:
        with tempfile.TemporaryDirectory() as d, sync_playwright() as pw:
            resume = Path(d) / 'synthetic-resume.pdf'; resume.write_bytes(b'%PDF-1.4\n% synthetic fixture\n')
            browser = pw.chromium.launch(headless=True, executable_path=chrome_path())
            browser_version = browser.version
            try:
                for site in SITES:
                    for state in ('cold', 'warm'):
                        for repeat in range(runs):
                            cache = None
                            if state == 'warm':
                                page = browser.new_page()
                                seed = execute_case(page, site, base + '/forms/' + site, 'enhanced', resume)
                                cache = seed['cache']; page.close()
                            # Alternate order to avoid consistently favoring one mode with host warmup.
                            modes = ('baseline', 'enhanced') if repeat % 2 == 0 else ('enhanced', 'baseline')
                            for mode in modes:
                                page = browser.new_page()
                                try:
                                    case = execute_case(page, site, base + '/forms/' + site, mode, resume, cache if mode == 'enhanced' else None)
                                    case_id = f'{site}-{state}-{mode}-{repeat + 1}'
                                    messages = case.pop('messages'); case.pop('cache')
                                    payload = json.dumps(messages, ensure_ascii=False, indent=2)
                                    (transcript_dir / (case_id + '.json')).write_bytes((payload + '\n').encode('utf-8'))
                                    case.update({'case_id': case_id, 'cache_state': state, 'repeat': repeat + 1,
                                                 'tokens': count_messages(messages), 'transcript_sha256': hashlib.sha256((payload + '\n').encode()).hexdigest()})
                                    case['tokens']['billed_usage'] = usage.get(case_id)
                                    rows.append(case)
                                    print(f'{case_id}: {case["total_seconds"]:.3f}s / {case["tokens"]["total_text_tokens"]} text tokens', flush=True)
                                finally:
                                    page.close()
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close()
    if set(usage) - {r['case_id'] for r in rows}:
        raise ValueError('Provider usage contains unknown benchmark case IDs')
    git = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    report = {'schema_version': 1, 'generated_at': datetime.now(timezone(timedelta(hours=8))).isoformat(),
              'environment': {'platform': platform.platform(), 'python': platform.python_version(), 'node': subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip(),
                              'browser': browser_version, 'playwright': version('playwright'), 'tiktoken': version('tiktoken'), 'matplotlib': version('matplotlib'), 'base_commit': git},
              'methodology': {'baseline': 'existing inventory + batch fill-plan + existing executor; fixture Agent decisions',
                              'enhanced': 'deterministic semantic mapping + compiler + same executor; fixture exception recipes',
                              'timing': 'real script/UI/save/receipt duration; excludes startup/navigation, model thinking and user approval',
                              'token_measurement': 'exact o200k_base tokenization of replay input/output text; not billed model usage',
                              'model_api_called': False, 'production_lane_live_tested': False,
                              'cold': 'no semantic cache', 'warm': 'fresh seed cache; seeding time excluded and upload rescan remains mandatory',
                              'runs_per_cell': runs, 'paired_order': 'alternating', 'rea_diagnostic_invoked': False,
                              'limitations': ['Synthetic Agent decisions exclude model errors and latency.', 'Browser timing does not predict live ATS throughput.',
                                              'No actual IAB/Chrome extension latency in this harness.', 'Existing baseline already batches; no per-field LLM strawman.',
                                              'REA deep-analysis overhead is not measured.', 'Warm cache validates rules again; it is not permission to replay stale selectors.']},
              'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__).parent / 'fixtures/form_sites.py', Path(__file__).parent / 'form_semantics.cjs', Path(__file__).parent / 'form_test_support.py']},
              'summary': summarize(rows), 'cases': rows}
    from token_metrics import audit_transcripts
    report['transcript_audit'] = audit_transcripts(report, transcript_dir)
    (out / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with (out / 'results.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['case_id', 'site', 'mode', 'cache_state', 'cache_hit', 'fill_seconds', 'total_seconds', 'correct_fields', 'receipt_verified', 'input_text_tokens', 'output_text_tokens', 'total_text_tokens', 'billed_input_tokens', 'billed_output_tokens'])
        writer.writeheader()
        for r in rows:
            flat = {k: r[k] for k in writer.fieldnames if k in r}; flat.update({k: r['tokens'][k] for k in ('input_text_tokens', 'output_text_tokens', 'total_text_tokens')})
            billed = r['tokens']['billed_usage']; flat.update({'billed_input_tokens': billed['input_tokens'] if billed else '', 'billed_output_tokens': billed['output_tokens'] if billed else ''}); writer.writerow(flat)
    from render_form_benchmark import render
    render(report, out)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runs', type=int, default=5); p.add_argument('--out', type=Path, default=Path('reports/rea-automation/latest'))
    p.add_argument('--usage-json', type=Path)
    args = p.parse_args()
    if not 1 <= args.runs <= 100:
        p.error('--runs must be 1..100')
    report = run(args.runs, args.out, args.usage_json)
    return 0 if all(r['receipt_verified'] for r in report['cases']) else 1


if __name__ == '__main__':
    sys.exit(main())
