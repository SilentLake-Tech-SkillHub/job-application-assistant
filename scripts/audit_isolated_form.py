"""Reconcile isolated real-model usage, full instruction delivery, cache provenance and gates."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from full_chain_benchmark import read_jsonl, usage_from_events, rollout_usage, truncated_outputs
from full_chain_progress import timestamp_ns, receipt_progress
from isolated_form_benchmark import cells


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def string_leaves(value):
    if isinstance(value, str):
        yield value
        if value.lstrip().startswith(('{', '[', '"')):
            try:
                decoded = json.loads(value)
            except ValueError:
                return
            if decoded != value:
                yield from string_leaves(decoded)
    elif isinstance(value, dict):
        for item in value.values():
            yield from string_leaves(item)
    elif isinstance(value, list):
        for item in value:
            yield from string_leaves(item)


def delivered_documents(events, rollout):
    visible = set()
    for e in rollout:
        p = e.get('payload', {})
        if e.get('type') == 'response_item' and p.get('type') in ('custom_tool_call_output', 'function_call_output'):
            visible.update(string_leaves(p.get('output')))
    documents = {}
    for e in events:
        if e.get('kind') != 'tool_completed' or e.get('error'):
            continue
        result = e.get('result', {})
        if e.get('name') == 'read_document' and 'text' in result:
            documents[result['path']] = result['text']
        elif e.get('name') == 'bootstrap':
            for doc in result['documents']:
                if 'text' in doc.get('document', {}):
                    documents[doc['path']] = doc['document']['text']
    required = {'SKILL.md', 'references/stage-contract.md', 'references/browser-application.md',
                'skills/application-content-fill/SKILL.md', 'skills/privacy-info-fill/SKILL.md'}
    assert required.issubset(documents), 'Missing required instruction reads'
    assert all(text in visible for text in documents.values()), 'Full document body missing from model-visible output'
    return {path: hashlib.sha256(body.encode('utf-8')).hexdigest() for path, body in documents.items()}


def audit(folder, private, partial=False):
    report = json.loads((folder / 'results.json').read_bytes())
    planned = {c['case_id']: c for c in cells()}
    results = report['results']
    assert len({r['case_id'] for r in results}) == len(results)
    checks = []
    for r in results:
        cell = planned[r['case_id']]
        assert all(r[k] == cell[k] for k in ('site', 'mode', 'cache_state'))
        assert r['model'] == report['model'] and r['reasoning_effort'] == 'high'
        work = private / (r['site'] + '-' + r['cache_state']) / r['mode']
        root = work / 'controller'
        events, tools = read_jsonl(work / 'cli-events.jsonl'), read_jsonl(root / 'tool-events.jsonl')
        assert r['completed'] and r['exit_code'] == 0 and not r['timed_out']
        assert usage_from_events(events) == r['usage']
        sessions = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions'
        selected, = sessions.glob('**/rollout-*-' + r['thread_id'] + '.jsonl')
        records = read_jsonl(selected)
        usage = rollout_usage(selected)
        assert usage['usage'] == r['usage'] and usage['requests'] == r['request_usage']
        for key, total in r['usage'].items():
            if total is not None:
                assert all(x['usage'].get(key) is not None for x in usage['requests'])
                assert sum(x['usage'][key] for x in usage['requests']) == total
        assert not truncated_outputs(records) and r['complete_delivery_valid']
        doc_hashes = delivered_documents(tools, records)
        verified = json.loads((root / 'verified-batch.json').read_bytes())
        assert verified == r['verified_batch'] and verified['closeout_gate']
        assert set(verified['sites']) == {r['site']}
        row = verified['sites'][r['site']]
        assert row['server_verified'] and row['tracker_verified']
        receipts = [e for e in tools if e.get('kind') == 'verified_receipt']
        assert len(receipts) == 1 and receipts[0]['receipt'] == row['receipt']
        assert r['site_progress'] == receipt_progress(r, tools, [r['site']])
        gates = [e for e in tools if e.get('kind') == 'stage_gate' and e.get('allowed')]
        assert any(e['stage'] == 'query' for e in gates)
        for stage in ('prepare', 'review', 'submit'):
            assert any(e['stage'] == stage and e['site'] == r['site'] and e['benchmark_phase'] == 'application' for e in gates)
        assert any(e['stage'] == 'closeout' and e['benchmark_phase'] == 'application' for e in gates)
        plan_path, = (root / 'workspace').rglob('填写方案.json')
        plan = json.loads(plan_path.read_bytes())
        assert plan['字段'] and all(f['状态'] == '已读回' for f in plan['字段'])
        assert digest(plan_path.parent / '审核包.md') in (plan_path.parent / '批准.md').read_text(encoding='utf-8')
        assert (plan_path.parent / '填写截图.png').is_file()
        cache = verified['isolated_case']['cache']
        assert not cache['reused_filled_plan'] and cache['seed_model_calls'] == 0
        assert cache['seconds'] == r['cache_seed_seconds']
        assert abs(r['wall_seconds'] - cache['seconds'] - r['wall_excluding_seed_seconds']) < 1e-6
        cache_events = [e for e in tools if e.get('kind') == 'cache_seed_completed']
        if r['cache_state'] == 'warm':
            assert cache['available'] and cache['seed_page_closed'] and cache['verified_automatic_fields'] > 0
            assert digest(root / 'verified-semantic-cache.json') == cache['sha256']
            source_cache = json.loads((root / 'verified-semantic-cache.json').read_bytes())
            assert source_cache['verified'] and source_cache['fingerprint'] == cache['fingerprint']
            assert len(cache_events) == 1
            seed_event = cache_events[0]
            assert not any(seed_event['start_wall_ns'] < timestamp_ns(q['timestamp']) < seed_event['wall_time_ns'] for q in r['request_usage']), 'Model request during local-only cache seed'
            assert cache['application_consumed'] == (r['mode'] == 'optimized')
        else:
            assert not cache['available'] and not cache['application_consumed'] and cache['seconds'] == 0
            assert not cache_events
        observations = verified['isolated_case']['cache_observations']
        if r['mode'] == 'baseline':
            assert not observations and verified['rea_calls'] == 0
        elif r['cache_state'] == 'warm':
            assert any(x['cache_hit'] and x['fingerprint'] == cache['fingerprint'] for x in observations)
        else:
            assert observations and not any(x['cache_hit'] for x in observations)
        rea = [e for e in tools if e.get('kind') == 'tool_completed' and e.get('name') == 'diagnose_bindings' and not e.get('error')]
        assert len(rea) == verified['rea_calls']
        for e in rea:
            raw, = [p for p in root.glob('rea-*.json') if digest(p) == e['result']['artifact_sha256']]
            evidence = json.loads(raw.read_bytes())
            assert evidence['operation'] == 'inspect_web_page' and evidence['confidence'] == 'observed'
            assert not e['result']['completeness']['truncated_sections']
        business_rejections = 0
        for e in tools:
            if e.get('kind') != 'tool_completed' or e.get('error'):
                continue
            result = e.get('result', {})
            if e.get('name') == 'complete_fields' and any(f.get('binding_failure') for f in result.get('forms', [])):
                business_rejections += 1
            elif e.get('name') == 'review_submit' and result.get('saved') is False:
                business_rejections += 1
            elif e.get('name') == 'review_submit_batch' and any(f.get('saved') is False for f in result.get('sites', {}).values()):
                business_rejections += 1
        checks.append({'case_id': r['case_id'], 'usage_reconciled': True, 'complete_document_bodies': doc_hashes,
                       'current_readback_fields': len(plan['字段']), 'stage_gates': True,
                       'review_hash_approved': True, 'server_and_tracker_verified': True,
                       'semantic_cache_verified': True, 'rea_calls': len(rea), 'business_rejection_returns': business_rejections,
                       'cli_events_sha256': digest(work / 'cli-events.jsonl'),
                       'tool_events_sha256': digest(root / 'tool-events.jsonl'), 'rollout_sha256': digest(selected)})
    complete = len(results) == 20 and {r['case_id'] for r in results} == set(planned)
    result = {'passed': complete, 'complete_grid': complete, 'validated_cells': len(checks), 'planned_cells': 20, 'checks': checks}
    (folder / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not partial:
        assert complete, 'Grid is not complete'
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--private', type=Path, required=True)
    p.add_argument('--allow-partial', action='store_true')
    args = p.parse_args()
    result = audit(args.report.resolve(), args.private.resolve(), args.allow_partial)
    print(json.dumps({k: v for k, v in result.items() if k != 'checks'}))
