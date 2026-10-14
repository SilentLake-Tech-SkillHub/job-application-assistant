#!/usr/bin/env python3
"""Independently reconcile private CLI/tool evidence against the public full-chain report."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from full_chain_benchmark import read_jsonl, normalize_usage, usage_from_events, rollout_usage
from fixtures.form_sites import SITES


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(folder, private):
    report = json.loads((folder / 'results.json').read_bytes())
    assert [r['mode'] for r in report['results']] == ['baseline', 'enhanced']
    audited = []
    for r in report['results']:
        work = private / r['mode']; controller = work / 'controller'
        events = read_jsonl(work / 'cli-events.jsonl'); tools = read_jsonl(controller / 'tool-events.jsonl')
        assert r['completed'] and r['exit_code'] == 0
        assert usage_from_events(events) == r['usage'], 'CLI reported usage mismatch'
        session_root = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions'
        selected = list(session_root.glob('**/rollout-*-' + r['thread_id'] + '.jsonl'))
        assert len(selected) == 1
        roll = rollout_usage(selected[0]); assert roll['usage'] == r['usage']
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
            if e.get('kind') != 'tool_completed' or e.get('name') != 'rea_inspect' or e.get('error'):
                continue
            summary = e['result']['summary']; sources = e['result']['captured_script_sources']
            raw = next(p for p in controller.glob('rea-*.json') if digest(p) == summary['artifact_sha256'])
            evidence = json.loads(raw.read_bytes())
            assert evidence['operation'] == 'inspect_web_page' and evidence['confidence'] == 'observed'
            assert evidence['normalized_result']['target']['target_id'] == summary['target_id']
            assert sources and all('text' in s and s['text'] for s in sources)
            assert not summary['completeness']['truncated_sections']
            rea_records.append({'site': raw.stem.removeprefix('rea-'), 'sha256': digest(raw),
                                'evidence_id': summary['evidence_id'], 'script_sources': len(sources), 'seconds': e['seconds']})
        if r['mode'] == 'enhanced':
            assert {x['site'] for x in rea_records} == {'search-dropdown', 'date-cascade', 'upload-rerender'}
        else:
            assert not rea_records
        audited.append({'mode': r['mode'], 'usage_matched_cli_and_rollout': True, 'request_count': roll['request_count'],
                        'summed_request_usage': summed, 'verified_receipts': 5, 'rea_captures': rea_records,
                        'cli_events_sha256': digest(work / 'cli-events.jsonl'),
                        'tool_events_sha256': digest(controller / 'tool-events.jsonl'),
                        'selected_rollout_sha256': digest(selected[0])})
    result = {'passed': True, 'checks': audited}
    (folder / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, required=True); p.add_argument('--private', type=Path, required=True)
    args = p.parse_args(); print(json.dumps(audit(args.report.resolve(), args.private.resolve()), ensure_ascii=False, indent=2))
