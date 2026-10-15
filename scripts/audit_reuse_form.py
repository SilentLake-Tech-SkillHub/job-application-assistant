"""Independent per-turn usage, evidence, rule lineage, current values and gate audit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from audit_isolated_form import delivered_documents, string_leaves
from full_chain_benchmark import read_jsonl, rollout_usage, usage_from_events, truncated_outputs
from reuse_form_benchmark import cells
from rea_rule_store import digest


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(report_dir, private, partial=False):
    data = json.loads((report_dir / 'results.json').read_bytes())
    planned = {r['case_id']: r for r in cells()}
    by_id = {r['case_id']: r for r in data['results']}
    assert len(by_id) == len(data['results'])
    checks = []
    sessions = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions'
    runtime_hashes, docs_hashes = None, None
    for r in data['results']:
        assert all(r[k] == planned[r['case_id']][k] for k in ('site', 'arm'))
        assert r['model'] == data['model'] == 'gpt-5.6-sol' and r['reasoning_effort'] == 'high'
        work = private / r['case_id'] / 'optimized'; root = work / 'controller'
        cli = read_jsonl(work / 'cli-events.jsonl'); events = read_jsonl(root / 'tool-events.jsonl')
        rollout_path, = sessions.glob('**/rollout-*-' + r['thread_id'] + '.jsonl')
        records = read_jsonl(rollout_path)
        usage = rollout_usage(rollout_path)
        assert r['completed'] and r['exit_code'] == 0 and not r['timed_out']
        assert usage_from_events(cli) == usage['usage'] == r['usage']
        assert usage['requests'] == r['request_usage']
        for k, v in r['usage'].items():
            if v is not None:
                assert all(q['usage'].get(k) is not None for q in usage['requests'])
                assert sum(q['usage'][k] for q in usage['requests']) == v
        assert r['complete_delivery_valid'] and not truncated_outputs(records)
        documents = delivered_documents(events, records)
        assert 'references/rea-rule-reuse.md' in documents
        if runtime_hashes is None:
            runtime_hashes, docs_hashes = r['runtime_sha256'], r['skill_sha256']
        assert r['runtime_sha256'] == runtime_hashes and r['skill_sha256'] == docs_hashes
        verified = json.loads((root / 'verified-batch.json').read_bytes())
        assert verified == r['verified_batch'] and verified['closeout_gate']
        row, = verified['sites'].values()
        assert row['server_verified'] and row['tracker_verified']
        receipt_events = [e for e in events if e.get('kind') == 'verified_receipt']
        assert len(receipt_events) == 1 and receipt_events[0]['receipt'] == row['receipt']
        gates = [e for e in events if e.get('kind') == 'stage_gate' and e.get('allowed')]
        assert all(any(e['stage'] == s for e in gates) for s in ('query', 'prepare', 'review', 'submit', 'closeout'))
        plan_path, = (root / 'workspace').rglob('填写方案.json')
        plan = json.loads(plan_path.read_bytes())
        assert plan['字段'] and all(f['状态'] == '已读回' for f in plan['字段'])
        assert sha(plan_path.parent / '审核包.md') in (plan_path.parent / '批准.md').read_text(encoding='utf-8')
        assert (plan_path.parent / '追踪表读回.md').is_file()
        boot, = [e['result'] for e in events if e.get('kind') == 'tool_completed' and e.get('name') == 'bootstrap' and not e.get('error')]
        profile, = [d['document']['facts'] for d in boot['documents'] if d['path'] == 'synthetic-profile']
        saved = json.loads((plan_path.parent / '审核包.md').read_text(encoding='utf-8').split('\n\n', 1)[1])
        assert all(value == ('synthetic-resume.pdf' if key == 'resume' else profile[key]) for key, value in saved.items())
        experiment = verified['rule_experiment']
        assert experiment['arm'] == r['arm']
        captures = [e for e in events if e.get('kind') == 'rea_learning_capture']
        assert len(captures) == verified['rea_calls']
        for capture in captures:
            raw = root / ('rea-' + r['site'] + '.json')
            assert sha(raw) == capture['evidence']['sha256']
            evidence = json.loads(raw.read_bytes())
            assert evidence['operation'] == 'inspect_web_page' and evidence['confidence'] == 'observed'
        promoted = [e for e in events if e.get('kind') == 'rule_promoted']
        consumed = [e for e in events if e.get('kind') == 'rule_reused']
        if r['arm'] == 'no-rea':
            assert not captures and not promoted and not consumed and not experiment['rule_reused']
        elif r['arm'] == 'first-rea':
            assert len(captures) == len(promoted) == 1 and not consumed
            assert promoted[0]['fresh_page_replay'] and promoted[0]['rule_sha256'] == experiment['learned_rule_sha256']
            assert any(e.get('kind') == 'rule_field_applied' and e.get('validation') for e in events)
            rule_path = private / 'rule-stores' / r['site'] / 'learned' / (digest('owned-mock://forms/' + r['site']) + '.json')
            rule = json.loads(rule_path.read_bytes())
            integrity = rule.pop('integrity_sha256')
            assert digest(rule) == integrity == experiment['learned_rule_sha256']
            assert rule['state'] == 'verified' and rule['evidence']['sha256'] == captures[0]['evidence']['sha256']
            assert all(value not in set(string_leaves(rule)) for key, value in profile.items() if key != 'degree')
        else:
            first = by_id[r['site'] + '-first-rea']['verified_batch']['rule_experiment']
            # A fallback is valid task execution but must not be mislabeled a successful cache hit.
            assert experiment['rule_reused'] == bool(consumed)
            if consumed:
                assert len(consumed) == 1 and not promoted
                assert experiment['consumed_rule_sha256'] == first['learned_rule_sha256']
                assert experiment['source_evidence_sha256'] == first['source_evidence_sha256']
                applied = [e for e in events if e.get('kind') == 'rule_field_applied' and not e.get('validation')]
                assert len(applied) == len(plan['字段']) and all(e['current_readback'] for e in applied)
                first_work = private / (r['site'] + '-first-rea') / 'optimized' / 'controller'
                prior_boot, = [e['result'] for e in read_jsonl(first_work / 'tool-events.jsonl') if e.get('kind') == 'tool_completed' and e.get('name') == 'bootstrap' and not e.get('error')]
                prior_profile, = [d['document']['facts'] for d in prior_boot['documents'] if d['path'] == 'synthetic-profile']
                assert all(profile[k] != prior_profile[k] for k in profile if k != 'degree')
        rejections = sum(e.get('kind') == 'tool_completed' and e.get('error', False) for e in events)
        business = 0
        for e in events:
            if e.get('kind') != 'tool_completed' or e.get('error'):
                continue
            outcome = e.get('result', {})
            if any(f.get('binding_failure') for f in outcome.get('forms', [])):
                business += 1
            sites = outcome.get('sites', {})
            if isinstance(sites, dict) and any(x.get('saved') is False for x in sites.values()):
                business += 1
        checks.append({'case_id': r['case_id'], 'usage_reconciled': True, 'current_values_verified': True,
            'complete_document_bodies': documents, 'current_readback_fields': len(plan['字段']),
            'gates_and_approval_hash_verified': True, 'rule_lineage_verified': True,
            'rea_calls': len(captures), 'rea_seconds': sum(e['timing']['cli_process_seconds'] for e in captures),
            'rule_reused': bool(consumed), 'tool_errors': rejections, 'business_rejections': business,
            'cli_sha256': sha(work / 'cli-events.jsonl'), 'tools_sha256': sha(root / 'tool-events.jsonl'),
            'rollout_sha256': sha(rollout_path)})
    assert len({r['thread_id'] for r in data['results']}) == len(data['results'])
    assert len({r['verified_batch']['sites'][r['site']]['receipt'] for r in data['results']}) == len(data['results'])
    complete = len(by_id) == 15 and set(by_id) == set(planned)
    result = {'passed': complete, 'validated_cells': len(checks), 'planned_cells': 15, 'checks': checks}
    (report_dir / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not partial:
        assert complete
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, required=True); p.add_argument('--private', type=Path, required=True)
    p.add_argument('--allow-partial', action='store_true'); args = p.parse_args()
    result = audit(args.report.resolve(), args.private.resolve(), args.allow_partial)
    print(json.dumps({k: v for k, v in result.items() if k != 'checks'}))
