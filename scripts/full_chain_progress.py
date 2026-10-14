"""Recover cumulative receipt progress from the owned run; never allocate shared tokens to sites."""
import argparse
import datetime
import json
from pathlib import Path
from full_chain_benchmark import read_jsonl


def timestamp_ns(value):
    return round(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1e9)


def receipt_progress(run, events):
    start = timestamp_ns(run['started_utc'])
    progress = []
    for event in events:
        if event.get('kind') != 'verified_receipt':
            continue
        elapsed = (event['wall_time_ns'] - start) / 1e9
        if not 0 <= elapsed <= run['wall_seconds'] + .01:
            raise ValueError('Receipt outside measured CLI interval')
        requests = [r for r in run['request_usage'] if timestamp_ns(r['timestamp']) <= event['wall_time_ns']]
        progress.append({'site': event['site'], 'batch_start_to_receipt_seconds': elapsed,
                         'reported_cumulative_tokens': sum(r['usage']['total_tokens'] for r in requests),
                         'reported_request_count': len(requests), 'receipt': event['receipt'],
                         'isolated_site_tokens': None, 'isolated_site_wall_seconds': None})
    if len(progress) != 5 or len({p['site'] for p in progress}) != 5:
        raise ValueError('Five distinct receipt events required')
    return progress


def enrich(folder, private):
    path = folder / 'results.json'
    report = json.loads(path.read_bytes())
    for run in report['results']:
        run['site_progress'] = receipt_progress(run, read_jsonl(private / run['mode'] / 'controller/tool-events.jsonl'))
    report['site_progress_boundary'] = 'Cumulative from batch CLI start, shared setup/model context included; not independent site cost'
    report['isolated_cold_warm_full_chain_measured'] = False
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--private', type=Path, required=True)
    args = p.parse_args()
    enrich(args.report.resolve(), args.private.resolve())
