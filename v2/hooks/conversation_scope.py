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


def current_conversation():
    # Codex exposes CODEX_THREAD_ID/CODEX_SESSION_ID; DeepSeek Harness exposes
    # DSH_SESSION_ID, which equals the hook payload's session_id. Accept exactly
    # one host-provided identity and reject conflicting values.
    ids = {os.environ.get(k) for k in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'DSH_SESSION_ID')} - {None, ''}
    if len(ids) != 1:
        raise ValueError('CURRENT_CONVERSATION_CONTEXT_REQUIRED')
    return ids.pop()


def update_scope(file, operation, *, policy_file=None, authorization_ref=None):
    conversation = current_conversation()
    # The host wiring declares its role. A maintainer host repairs shared code
    # and can never register itself as an application executor.
    if operation == 'enable' and (os.environ.get('RECRUITING_HOST_ROLE') or 'executor').strip() == 'maintainer':
        raise ValueError('HOST_ROLE_MAINTAINER_CANNOT_ENABLE_EXECUTION')
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
        data = json.loads(file.read_text(encoding='utf-8')) if file.exists() else {'version': 1, 'session_ids': []}
        if operation == 'enable':
            if not policy_file or not authorization_ref or not str(authorization_ref).strip():
                raise ValueError('WORKFLOW_ACTIVATION_EVIDENCE_REQUIRED')
            policy_file = Path(policy_file).resolve()
            sha = hashlib.sha256(policy_file.read_bytes()).hexdigest()
            data.setdefault('sessions', {})[conversation] = {
                'workflow': 'job-application-assistant-v2', 'policy_path': str(policy_file),
                'policy_sha256': sha, 'authorization_ref': str(authorization_ref),
            }
            data['session_ids'] = sorted(set(data.get('session_ids', [])) | {conversation})
        elif operation == 'disable':
            data['session_ids'] = [s for s in data.get('session_ids', []) if s != conversation]
            data.get('sessions', {}).pop(conversation, None)
        else:
            raise ValueError('UNKNOWN_SCOPE_OPERATION')
        fd, tmp = tempfile.mkstemp(dir=file.parent, prefix=file.name + '.', suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as out:
                json.dump(data, out, ensure_ascii=False, indent=2)
                out.write('\n')
            os.replace(tmp, file)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return {'conversation_id': conversation, 'active': operation == 'enable',
            'scope': 'conversation', 'other_conversations_changed': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=['enable', 'disable'])
    p.add_argument('--scope-file', required=True)
    p.add_argument('--policy-file')
    p.add_argument('--authorization-ref')
    a = p.parse_args()
    try:
        print(json.dumps(update_scope(a.scope_file, a.operation,
                                     policy_file=a.policy_file, authorization_ref=a.authorization_ref)))
    except Exception as e:
        p.exit(2, str(e) + '\n')
