#!/usr/bin/env python3
"""Conversation-scoped short call route; execution facts are checked inside MCP."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(os.environ['RECRUITING_WORKSPACE_ROOT']).resolve()
POLICY = Path(os.environ['RECRUITING_WORKFLOW_POLICY'])
LOCK = Path(os.environ['RECRUITING_WORKFLOW_LOCK'])
STATE = Path(os.environ['RECRUITING_WORKFLOW_STATE'])
SCOPE = Path(os.environ['RECRUITING_WORKFLOW_SCOPE'])
INJECT = {'UserPromptSubmit', 'SessionStart', 'SubagentStart'}
ROUTE = Path(__file__).with_name('route.md')
MUTATIONS = {'batch_prepare','role_prepare','roles_prepare_batch','roles_patch_text','material_import_run','login_prepare','login_request_sms','login_verify_otp','application_closeout'}


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')))


def key(session, turn):
    return hashlib.sha256((session + '\0' + turn).encode()).hexdigest()


def write_atomic(file, value):
    tmp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
    os.replace(tmp, file)


def handle(event):
    started = time.perf_counter()
    # This workflow belongs to an explicitly enabled conversation, not every
    # conversation sharing the project. Return before policy/receipt checks for
    # unrelated sessions, including continuations started before installation.
    try:
        sessions = json.loads(SCOPE.read_text(encoding='utf-8')).get('session_ids', [])
    except (FileNotFoundError, ValueError):
        return {}
    if event.get('session_id') not in sessions:
        return {}
    cwd = Path(event.get('cwd') or ROOT).resolve()
    if cwd != ROOT and ROOT not in cwd.parents:
        return {}
    name = event.get('hook_event_name')
    if name not in INJECT | {'PreToolUse'}:
        return {}
    tool = event.get('tool_name', '')
    # Source repair, Skill reads and status reporting must remain possible even
    # when an enabled conversation has no same-turn application receipt.
    if name == 'PreToolUse' and tool.split('__')[-1] not in MUTATIONS:
        return {}
    if name == 'PreToolUse' and tool.startswith('mcp__recruiting_form__'):
        raise ValueError('V2_RUNTIME_REQUIRED_USE_RECRUITING_APPLICATION_V2')
    body = POLICY.read_bytes()
    sha = hashlib.sha256(body).hexdigest()
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    route_sha = hashlib.sha256(ROUTE.read_bytes()).hexdigest()
    if lock.get('route_sha256') and route_sha != lock['route_sha256']:
        raise ValueError('WORKFLOW_ROUTE_HASH_CHANGED')
    if sha != lock['sha256']:
        raise ValueError('WORKFLOW_INSTRUCTION_HASH_CHANGED')
    session, turn = event.get('session_id'), event.get('turn_id')
    if not session or (name in {'UserPromptSubmit', 'PreToolUse'} and not turn):
        raise ValueError('WORKFLOW_EVENT_ID_MISSING')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    receipt = STATE / (key(session, turn) + '.json') if turn else None
    if name in INJECT:
        text = ROUTE.read_text(encoding='utf-8')
        context = ('本轮求职调用入口；后续用户明确修改及上级指令优先。\n'
                   '版本：' + lock['version'] + '；SHA256：' + sha + '\n'
                   '速度要求不放宽；Hook与监督开销均计入用户视角总耗时。\n\n' + text)
        if receipt:
            write_atomic(receipt, {'session_id': session, 'turn_id': turn,
                                  'sha256': sha, 'route_sha256': route_sha, 'event': name, 'at': time.time()})
        # Store only event metadata, never the user's prompt, tool input or personal facts.
        record = {'event': name, 'session_id': session, 'turn_id': turn,
                  'sha256': sha, 'instruction_bytes': len(text.encode('utf-8')),
                  'elapsed_ms': round((time.perf_counter() - started) * 1000, 3), 'at': time.time()}
        fd = os.open(STATE / 'injections.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
        return {'hookSpecificOutput': {'hookEventName': name, 'additionalContext': context}}
    try:
        loaded = json.loads(receipt.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise ValueError('WORKFLOW_NOT_LOADED_FOR_THIS_TURN')
    if loaded.get('route_sha256') != route_sha or loaded.get('sha256') != sha or loaded.get('session_id') != session or loaded.get('turn_id') != turn:
        raise ValueError('WORKFLOW_TURN_RECEIPT_MISMATCH')
    return {}


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    try:
        emit(handle(json.load(sys.stdin)))
    except Exception as error:
        # Exit 2 is the documented blocking contract, including unreadable policy/state.
        print('固定执行指令门禁拒绝：' + str(error), file=sys.stderr)
        sys.exit(2)
