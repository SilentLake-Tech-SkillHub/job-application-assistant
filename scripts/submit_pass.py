"""Submit pass: the link between the submit gate and the platform hook.

`stage_gate.py --stage submit` writes a pass after the gate allows one role. The PreToolUse hook
(`hooks/application_guard.py`) lets a final-submit-like browser click through only while a pass is
valid, and spends one click per use. A pass covers one role for a short window and a few clicks
(the submit button plus the site's confirmation modal), then expires.
"""
import datetime
import json
from pathlib import Path

PASS_FILE = '门禁通行证.json'
EVIDENCE_DIR = '投递证据'
VALID_MINUTES = 10
CLICKS = 3


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def pass_path(root):
    return Path(root) / EVIDENCE_DIR / PASS_FILE


def issue_submit_pass(root, data, role_key, minutes=VALID_MINUTES, clicks=CLICKS, ledger=None):
    role = next((r for r in data.get('roles') or [] if isinstance(r, dict) and r.get('role_key') == role_key), {})
    batch = data.get('batch') if isinstance(data.get('batch'), dict) else {}
    issued = now()
    record = {'batch_id': batch.get('batch_id'), 'role_key': role_key, 'title': role.get('title'),
              'review_hash': role.get('review_hash'), 'issued_at': issued.isoformat(timespec='seconds'),
              'expires_at': (issued + datetime.timedelta(minutes=minutes)).isoformat(timespec='seconds'),
              'clicks_left': clicks, 'ledger': ledger_ref(root, ledger)}
    path = pass_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'file': EVIDENCE_DIR + '/' + PASS_FILE, 'role_key': role_key, 'expires_at': record['expires_at'], 'clicks': clicks}


def ledger_ref(root, ledger):
    if ledger is None:
        return None
    ledger, base = Path(ledger).resolve(), Path(root).resolve()
    return ledger.relative_to(base).as_posix() if base in ledger.parents else str(ledger)


def role_already_done(root, record):
    """A pass is void once its role is recorded as submitted or uncertain in the ledger it came from."""
    if not record.get('ledger'):
        return None
    path = Path(record['ledger'])
    path = path if path.is_absolute() else Path(root) / path
    data = json.loads(path.read_text(encoding='utf-8'))
    role = next((r for r in data.get('roles') or [] if isinstance(r, dict) and r.get('role_key') == record.get('role_key')), None)
    if role is None:
        return 'role not in ledger'
    return role.get('stage') if role.get('stage') in {'submitted', 'uncertain'} else None


def consume_submit_click(root):
    """Spend one click from a valid pass. Returns (allowed, message)."""
    path = pass_path(root)
    if not path.is_file():
        return False, 'no submit pass'
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
        expires = datetime.datetime.fromisoformat(record['expires_at'])
        left = int(record.get('clicks_left', 0))
    except (OSError, ValueError, KeyError, TypeError):
        return False, 'submit pass unreadable'
    if expires <= now():
        return False, 'submit pass expired at ' + record['expires_at']
    if left <= 0:
        return False, 'submit pass already used for ' + str(record.get('role_key'))
    try:
        done = role_already_done(root, record)
    except (OSError, ValueError, TypeError, AttributeError):
        return False, 'submit pass ledger unreadable'
    if done:
        return False, 'submit pass void: ' + str(record.get('role_key')) + ' is ' + done + ' in the ledger'
    record['clicks_left'] = left - 1
    record.setdefault('used_at', []).append(now().isoformat(timespec='seconds'))
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return True, 'submit pass for ' + str(record.get('role_key')) + ' (' + str(left - 1) + ' clicks left)'
