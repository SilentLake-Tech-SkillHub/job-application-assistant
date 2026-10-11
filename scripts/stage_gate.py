#!/usr/bin/env python3
"""Stage gate: may the batch (or one role) move to the next stage? (stage contract §10)

The gate validates the ledger as it would look *after* the transition. Any error blocks the
transition; exit status 0 means allowed, 1 blocked, 2 unreadable input. Structural only: it
cannot prove a website saved or received anything.

  stage_gate.py batch.json --stage query
  stage_gate.py batch.json --stage prepare --role <role_key>
  stage_gate.py batch.json --stage review  --role <role_key>
  stage_gate.py batch.json --stage submit  --role <role_key>
  stage_gate.py batch.json --stage closeout
"""
import argparse
import copy
import datetime
import json
import sys
from pathlib import Path

from validate_batch import validate
from ledger_checks import evidence_errors, closeout_status

ORDER = ['discovered', 'verified', 'preparing', 'prepared', 'reviewed', 'submit_clicked', 'submitted', 'uncertain']
SIMULATED = 'stage-gate-simulation'


def simulate(data, stage, role_key):
    """Return a copy of the ledger with the requested transition applied, or an error string."""
    after = copy.deepcopy(data)
    if stage in {'query', 'closeout'}:
        return after, None
    raw = after.get('roles') if isinstance(after.get('roles'), list) else []
    roles = [r for r in raw if isinstance(r, dict) and r.get('role_key') == role_key]
    if len(roles) != 1:
        return None, 'role ' + repr(role_key) + ' not found exactly once'
    role = roles[0]
    if role.get('historical_readonly') is True:
        return None, 'role ' + repr(role_key) + ' is a read-only history record'
    current = role.get('stage') if isinstance(role.get('stage'), str) else None
    if not isinstance(role.get('execution'), dict):
        role['execution'] = {}
    execution = role['execution']
    if stage == 'prepare':
        if current not in {'verified', 'preparing'}:
            return None, 'prepare gate applies to a verified/preparing role, not ' + repr(current)
        role['stage'] = 'preparing'
        if not isinstance(execution.get('fill'), dict) or execution['fill'].get('status') == 'not_started':
            execution['fill'] = {'status': 'in_progress', 'evidence_ref': SIMULATED}
    elif stage == 'review':
        if current not in {'prepared', 'reviewed'}:
            return None, 'review gate needs a prepared role (fill readback + saved draft or no-draft evidence), not ' + repr(current)
        role['stage'] = 'reviewed'
    elif stage == 'submit':
        if current != 'reviewed':
            return None, 'submit gate needs a reviewed and approved role, not ' + repr(current)
        role['stage'] = 'submit_clicked'
        execution['submit'] = {'status': 'in_progress', 'evidence_ref': SIMULATED}
    return after, None


def run(data, stage, role_key=None, evidence_root=None):
    after, problem = simulate(data, stage, role_key)
    if problem:
        return {'stage': stage, 'role': role_key, 'allowed': False, 'errors': [problem]}
    errors, report = validate(after)
    if evidence_root:
        errors.extend(evidence_errors(data, evidence_root))
    result = {'stage': stage, 'role': role_key, 'allowed': not errors, 'errors': errors,
              'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
    if stage == 'closeout':
        result['closeout'] = closeout_status(after, report)
        result['allowed'] = result['allowed'] and result['closeout']['can_close']
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('batch_json', type=Path)
    parser.add_argument('--stage', required=True, choices=['query', 'prepare', 'review', 'submit', 'closeout'])
    parser.add_argument('--role', help='role_key for prepare/review/submit')
    parser.add_argument('--evidence-root', type=Path)
    args = parser.parse_args()
    if args.stage in {'prepare', 'review', 'submit'} and not args.role:
        parser.error('--role is required for ' + args.stage)
    try:
        data = json.loads(args.batch_json.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('root must be an object')
    except (OSError, ValueError) as exc:
        print(json.dumps({'allowed': False, 'errors': [str(exc)]}, ensure_ascii=False))
        return 2
    result = run(data, args.stage, args.role, args.evidence_root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['allowed'] else 1


if __name__ == '__main__':
    sys.exit(main())
