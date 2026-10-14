#!/usr/bin/env python3
"""Independently reconcile private CLI/tool evidence against the public full-chain report."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from full_chain_benchmark import read_jsonl, normalize_usage, usage_from_events, rollout_usage, truncated_outputs, COMPARISONS
from fixtures.form_sites import SITES
from full_chain_progress import receipt_progress


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(folder, private):
    report = json.loads((folder / 'results.json').read_bytes())
    expected = list(COMPARISONS[report.get('comparison', 'baseline-enhanced')])
    assert [r['mode'] for r in report['results']] == expected
    audited = []
    for r in report['results']:
        work = private / r['mode']; controller = work / 'controller'
        events = read_jsonl(work / 'cli-events.jsonl'); tools = read_jsonl(controller / 'tool-events.jsonl')
        assert r['completed'] and r['exit_code'] == 0
        if 'site_progress' in r:
            assert r['site_progress'] == receipt_progress(r, tools), 'Cumulative receipt progress mismatch'
        assert usage_from_events(events) == r['usage'], 'CLI reported usage mismatch'
        session_root = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions'
        selected = list(session_root.glob('**/rollout-*-' + r['thread_id'] + '.jsonl'))
        assert len(selected) == 1
        roll = rollout_usage(selected[0]); assert roll['usage'] == r['usage']
        if report.get('protocol_version', 1) >= 2:
            assert not truncated_outputs(read_jsonl(selected[0])), 'Model-visible instruction output was truncated'
            assert r['complete_delivery_valid'] and not r['truncated_outputs']
        assert roll['requests'] == r['request_usage']
        summed = {}
        for key, total in r['usage'].items():
            if total is not None:
                assert all(x['usage'] and x['usage'].get(key) is not None for x in roll['requests'])
                summed[key] = sum(x['usage'][key] for x in roll['requests'])
                assert summed[key] == total, 'Per-request total mismatch: ' + key
        verified = json.loads((controller / 'verified-batch.json').read_bytes())
        assert verified == r['verified_batch'] and verified['closeout_gate']
        assert set(verified['sites']) == set(SITES)
        receipt_events = [e for e in tools if e.get('kind') == 'verified_receipt']
        assert len(receipt_events) == 5 and {e['site'] for e in receipt_events} == set(SITES)
        for e in receipt_events:
            row = verified['sites'][e['site']]
            assert row['receipt'] == e['receipt'] and row['server_verified'] and row['tracker_verified']
        rea_records = []
        for e in tools:
            if e.get('kind') != 'tool_completed' or e.get('name') not in ('rea_inspect', 'diagnose_bindings') or e.get('error'):
                continue
            summary = e['result'].get('summary', e['result'])
            sources = e['result'].get('captured_script_sources', e['result'].get('scripts'))
            raw = next(p for p in controller.glob('rea-*.json') if digest(p) == summary['artifact_sha256'])
            evidence = json.loads(raw.read_bytes())
            if sources is None:
                sources = [s['source']['artifact'] for s in evidence['normalized_result']['scripts']['items']
                           if s.get('source', {}).get('included')]
                assert {s['sha256'] for s in e['result']['excerpts']}.issubset({s['sha256'] for s in sources})
            assert evidence['operation'] == 'inspect_web_page' and evidence['confidence'] == 'observed'
            if 'target_id' in summary:
                assert evidence['normalized_result']['target']['target_id'] == summary['target_id']
            assert sources and all('text' in s and s['text'] for s in sources)
            assert not summary['completeness']['truncated_sections']
            rea_records.append({'site': raw.stem.removeprefix('rea-'), 'sha256': digest(raw),
                                'evidence_id': summary['evidence_id'], 'script_sources': len(sources), 'seconds': e['seconds']})
        if r['mode'] == 'enhanced':
            assert {x['site'] for x in rea_records} == {'search-dropdown', 'date-cascade', 'upload-rerender'}
        elif r['mode'] == 'baseline':
            assert not rea_records
        plans = list((controller / 'workspace').rglob('填写方案.json'))
        assert len(plans) == 5
        for plan_path in plans:
            plan = json.loads(plan_path.read_bytes())
            assert all(f['状态'] == '已读回' for f in plan['字段'])
            review = plan_path.parent / '审核包.md'
            approval = plan_path.parent / '批准.md'
            assert digest(review) in approval.read_text(encoding='utf-8')
        gate_checks = {'current_review_hash_approved': 5, 'readback_plans': 5}
        if r['mode'] == 'optimized':
            gates = [e for e in tools if e.get('kind') == 'stage_gate']
            for stage in ('prepare', 'review', 'submit'):
                assert {e['site'] for e in gates if e['stage'] == stage and e['allowed']} == set(SITES)
            assert any(e['stage'] == 'query' and e['allowed'] for e in gates)
            assert any(e['stage'] == 'closeout' and e['allowed'] for e in gates)
            gate_checks = {'query': True, 'prepare': 5, 'review': 5, 'submit': 5, 'closeout': True,
                           'current_review_hash_approved': 5, 'readback_plans': 5}
        audited.append({'mode': r['mode'], 'usage_matched_cli_and_rollout': True, 'request_count': roll['request_count'],
                        'summed_request_usage': summed, 'verified_receipts': 5, 'rea_captures': rea_records,
                        'stage_gates': gate_checks,
                        'site_progress_matched': True if 'site_progress' in r else None,
                        'complete_output_delivery': not truncated_outputs(read_jsonl(selected[0])),
                        'cli_events_sha256': digest(work / 'cli-events.jsonl'),
                        'tool_events_sha256': digest(controller / 'tool-events.jsonl'),
                        'selected_rollout_sha256': digest(selected[0])})
    result = {'passed': True, 'eligible_for_complete_instruction_comparison':
              all(r['complete_output_delivery'] for r in audited), 'checks': audited}
    (folder / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, required=True); p.add_argument('--private', type=Path, required=True)
    args = p.parse_args(); print(json.dumps(audit(args.report.resolve(), args.private.resolve()), ensure_ascii=False, indent=2))
