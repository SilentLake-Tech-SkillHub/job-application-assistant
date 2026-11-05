#!/usr/bin/env python3
"""Activate a workflow only for the host-provided current conversation.

No project-wide activation, hard-coded conversation ID, model call or network.
The lifecycle hook consumes session_ids; only this host command manages them.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from contextlib import contextmanager

REGISTRATION_SECONDS = 12 * 3600


@contextmanager
def scope_lock(file):
    file = Path(file).resolve()
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_fd = os.open(str(file) + '.lock', os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(lock.fileno()).st_size == 0:
                lock.write('0'); lock.flush()
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield file


def write_scope(file, data):
    fd, tmp = tempfile.mkstemp(dir=file.parent, prefix=file.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.write('\n')
        os.replace(tmp, file)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def prune_expired(data, now):
    records = data.get('sessions', {})
    valid = {}
    for sid in data.get('session_ids', []):
        record = records.get(sid, {})
        start, end = record.get('registeredAt'), record.get('expiresAt')
        if (type(start) in (int, float) and type(end) in (int, float)
                and start <= now < end and end - start == REGISTRATION_SECONDS):
            valid[sid] = record
    data['session_ids'] = sorted(valid)
    data['sessions'] = valid
    return data


def read_active_scope(file, *, now=None):
    """Read and atomically remove expired/untimed registrations; never renew them."""
    if not Path(file).exists(): return {'version': 1, 'session_ids': [], 'sessions': {}}
    with scope_lock(file) as file:
        data = json.loads(file.read_text(encoding='utf-8'))
        before = json.dumps(data, sort_keys=True)
        prune_expired(data, time.time() if now is None else now)
        if json.dumps(data, sort_keys=True) != before: write_scope(file, data)
        return data


def host_role():
    role = (os.environ.get('RECRUITING_HOST_ROLE') or 'executor').strip()
    if role not in {'executor', 'maintainer'}:
        raise ValueError('INVALID_RECRUITING_HOST_ROLE')
    return role


def current_conversation():
    # Codex exposes CODEX_THREAD_ID/CODEX_SESSION_ID; DeepSeek Harness exposes
    # DSH_SESSION_ID, which equals the hook payload's session_id. Accept exactly
    # one host-provided identity and reject conflicting values.
    ids = {os.environ.get(k) for k in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'DSH_SESSION_ID')} - {None, ''}
    if len(ids) != 1:
        raise ValueError('CURRENT_CONVERSATION_CONTEXT_REQUIRED')
    return ids.pop()


def update_scope(file, operation, *, policy_file=None, authorization_ref=None, target_sessions=None,
                 retain_session=None, now=None):
    conversation = current_conversation()
    now = time.time() if now is None else now
    # The host wiring declares its role. A maintainer host repairs shared code
    # and can never register itself as an application executor.
    if operation == 'enable' and host_role() == 'maintainer':
        raise ValueError('HOST_ROLE_MAINTAINER_CANNOT_ENABLE_EXECUTION')
    if target_sessions and operation != 'disable':
        raise ValueError('TARGET_SESSION_ONLY_FOR_DISABLE')
    if retain_session and operation != 'migrate':
        raise ValueError('RETAIN_SESSION_ONLY_FOR_MIGRATION')
    if (target_sessions or operation == 'migrate') and not str(authorization_ref or '').strip():
        raise ValueError('EXPLICIT_SCOPE_MAINTENANCE_EVIDENCE_REQUIRED')
    with scope_lock(file) as file:
        data = json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'version': 1, 'session_ids': []}
        if (target_sessions or operation == 'migrate') and conversation in data.get('session_ids', []):
            raise ValueError('ACTIVE_EXECUTOR_CANNOT_ADMINISTER_OTHER_SESSIONS')
        if operation == 'enable':
            if not policy_file or not authorization_ref or not str(authorization_ref).strip():
                raise ValueError('WORKFLOW_ACTIVATION_EVIDENCE_REQUIRED')
            policy_file = Path(policy_file).resolve()
            sha = hashlib.sha256(policy_file.read_bytes()).hexdigest()
            prune_expired(data, now)
            previous = data.setdefault('sessions', {}).get(conversation)
            agent_id = os.environ.get('RECRUITING_AGENT_ID')
            if agent_id:
                registry_file = file.parent.parent.parent / '.runtime' / 'agents.json'
                registry = json.loads(registry_file.read_text(encoding='utf-8'))
                agent = registry.get('agents', {}).get(agent_id)
                if not agent or agent.get('host') != os.environ.get('RECRUITING_HOST_ID'):
                    raise ValueError('AGENT_HOST_IDENTITY_MISMATCH')
                if previous and previous.get('agentId') not in {None, agent_id}:
                    raise ValueError('CONVERSATION_AGENT_IDENTITY_CHANGED')
            record = {
                'workflow': 'job-application-assistant-v2', 'policy_path': str(policy_file),
                'policy_sha256': sha, 'authorization_ref': str(authorization_ref),
                'registeredAt': now, 'expiresAt': now + REGISTRATION_SECONDS,
            }
            if agent_id or (previous and previous.get('agentId')):
                record['agentId'] = agent_id or previous['agentId']
            if previous:
                record['registeredAt'], record['expiresAt'] = previous['registeredAt'], previous['expiresAt']
            data['sessions'][conversation] = record
            data['session_ids'] = sorted(set(data.get('session_ids', [])) | {conversation})
        elif operation == 'disable':
            targets = set(target_sessions or [conversation])
            data['session_ids'] = [s for s in data.get('session_ids', []) if s not in targets]
            for sid in targets: data.get('sessions', {}).pop(sid, None)
        elif operation == 'migrate':
            if not retain_session or retain_session not in data.get('session_ids', []):
                raise ValueError('EXISTING_EXECUTOR_REGISTRATION_REQUIRED')
            record = data.get('sessions', {}).get(retain_session)
            if not record or not record.get('policy_sha256'):
                raise ValueError('EXISTING_EXECUTOR_POLICY_REQUIRED')
            # One deployment cutover: preserve only the executor verified by the
            # maintainer. A timed registration never gets a fresh expiry here.
            if 'registeredAt' not in record:
                record.update(registeredAt=now, expiresAt=now + REGISTRATION_SECONDS)
            data['session_ids'], data['sessions'] = [retain_session], {retain_session: record}
            prune_expired(data, now)
        else:
            raise ValueError('UNKNOWN_SCOPE_OPERATION')
        write_scope(file, data)
    return {'conversation_id': conversation, 'active': operation == 'enable',
            'scope': 'conversation', 'other_conversations_changed': bool(target_sessions or retain_session),
            'disabled_sessions': sorted(target_sessions or [])}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=['enable', 'disable', 'migrate'])
    p.add_argument('--scope-file', required=True)
    p.add_argument('--policy-file')
    p.add_argument('--authorization-ref')
    p.add_argument('--target-session', action='append')
    p.add_argument('--retain-session')
    a = p.parse_args()
    try:
        print(json.dumps(update_scope(a.scope_file, a.operation,
                                     policy_file=a.policy_file, authorization_ref=a.authorization_ref,
                                     target_sessions=a.target_session, retain_session=a.retain_session)))
    except Exception as e:
        p.exit(2, str(e) + '\n')
