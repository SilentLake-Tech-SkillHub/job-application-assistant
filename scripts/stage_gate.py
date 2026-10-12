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

Evidence is strict by default: every reference must be a file under the application root's
投递证据/ folder (root = nearest ancestor of the ledger containing 投递证据/, or --root).
A passing submit gate writes 投递证据/门禁通行证.json, which the PreToolUse hook requires
before a final-submit click (hooks/application_guard.py).
"""
import argparse
import copy
import datetime
import json
import sys
from pathlib import Path

from validate_batch import validate
from ledger_checks import evidence_errors, closeout_status, find_root, EVIDENCE_DIR
from submit_pass import issue_submit_pass

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


def run(data, stage, role_key=None, root=None, strict=None):
    """strict=None: no evidence check (library use); the CLI always passes strict=True unless --lenient."""
    after, problem = simulate(data, stage, role_key)
    if problem:
        return {'stage': stage, 'role': role_key, 'allowed': False, 'errors': [problem]}
    errors, report = validate(after)
    if root is not None and strict is not None:
        errors.extend(evidence_errors(data, root, strict=strict))
    elif strict:
        errors.append('strict evidence: application root with ' + EVIDENCE_DIR + '/ not found; pass --root or --lenient')
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
    parser.add_argument('--root', type=Path, help='application root containing 投递证据/ (default: nearest ancestor of the ledger)')
    parser.add_argument('--lenient', action='store_true', help='legacy ledgers only: skip the strict file-evidence check')
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
    root = args.root or find_root(args.batch_json)
    result = run(data, args.stage, args.role, root, strict=not args.lenient)
    if args.stage == 'submit' and result['allowed'] and root is not None and not args.lenient:
        result['submit_pass'] = issue_submit_pass(root, data, args.role, ledger=args.batch_json)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['allowed'] else 1


if __name__ == '__main__':
    sys.exit(main())
