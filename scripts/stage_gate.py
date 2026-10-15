#!/usr/bin/env python3
"""Stage gate: may the batch (or one role) move to the next stage? (stage contract §10)

  stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage query
  stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage prepare --url <岗位链接>
  stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage review  --url <岗位链接>
  stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage submit  --url <岗位链接>
  stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage closeout

Reads only the Excel tracker and 投递证据/. Exit 0 allowed, 1 blocked, 2 unreadable input.
Every stage also enforces tracker consistency: a scanned company must carry one of the five
盘点状态 labels, and a receipt must be booked as 投递状态=已提交 (and vice versa).
A passing submit gate issues 投递证据/门禁通行证.md for the PreToolUse hook.
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

from batch_check import Batch
from submit_pass import issue_submit_pass


def run(workbook, batch_id, stage, url=None, root=None):
    batch = Batch(workbook, batch_id, root)
    errors = list(batch.errors)
    if stage == 'query':
        errors += batch.query_errors() + batch.book.label_errors(batch.scope.keys()) + batch.attempt_errors()
    else:
        errors += batch.consistency_errors()
    if stage in ('prepare', 'review', 'submit'):
        errors += batch.role_gate(url, stage)
    result = {'阶段': stage, '岗位链接': url, '允许': not errors, '错误': list(dict.fromkeys(errors)),
              '检查时间': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
    if stage == 'closeout':
        report = batch.report(include_fill_progress=False)
        result['报告'] = report
        result['收尾'] = batch.closeout(report)
        result['允许'] = result['允许'] and result['收尾']['可以收尾']
    if stage == 'submit' and result['允许']:
        row = batch.book.role_by_url(url)[0]
        try:
            result['提交通行证'] = issue_submit_pass(batch.root, batch_id, url, batch.role_dir(row['公司'], url))
        except ValueError as exc:  # defence in depth: the pass refuses on its own as well
            result['允许'], result['错误'] = False, result['错误'] + ['不发提交通行证：' + str(exc)]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--workbook', required=True, type=Path)
    parser.add_argument('--batch', required=True)
    parser.add_argument('--stage', required=True, choices=['query', 'prepare', 'review', 'submit', 'closeout'])
    parser.add_argument('--url', help='岗位链接 (prepare/review/submit)')
    parser.add_argument('--root', type=Path)
    args = parser.parse_args()
    if args.stage in ('prepare', 'review', 'submit') and not args.url:
        parser.error('--url is required for ' + args.stage)
    try:
        result = run(args.workbook, args.batch, args.stage, args.url, args.root)
    except Exception as exc:  # noqa: BLE001 - unreadable workbook or evidence
        print(json.dumps({'允许': False, '错误': ['无法读取：' + type(exc).__name__ + ' ' + str(exc)[:200]]}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['允许'] else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
