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
MUTATIONS = {'batch_prepare','role_prepare','roles_prepare_batch','workflow_advance','roles_patch_text','material_import_run','login_prepare','login_request_sms','login_verify_otp','application_closeout'}
LEGACY_CONTINUATION_TOOLS = {'workflow_next', 'form_route', 'workflow_advance', 'role_prepare', 'prepare_plan', 'batch_prepare', 'role_verify', 'verify_current', 'capture_rea_structure', 'capture_controls', 'form_mapping_candidates', 'capture_choice_options', 'form_build_template', 'template_register', 'probe_conditions', 'template_finalize', 'profile_map_questions', 'material_import_prepare', 'material_import_run', 'roles_prepare_batch', 'roles_patch_text', 'workflow_handoff'}

LIFECYCLE = json.loads((Path(__file__).resolve().parents[1] / 'catalog/workflow-tools.json').read_text(encoding='utf-8'))
CONTINUATION_TOOLS = set(LIFECYCLE['stages']) | LEGACY_CONTINUATION_TOOLS

def recruiting_tool(tool):
    return 'recruiting_application_v2' in tool.replace('-', '_') or 'recruiting_login_v2' in tool.replace('-', '_')


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


def continuation_result(value):
    if isinstance(value, str):
        try:
            value = json.loads(value.removeprefix('Error: '))
        except ValueError:
            return None
    if not isinstance(value, dict):
        return None
    for wrapper in ('result', 'data', 'structuredContent', 'output'):
        if isinstance(value.get(wrapper), (dict, str)):
            found = continuation_result(value[wrapper])
            if found:
                return found
    if isinstance(value.get('content'), list):
        for block in value['content']:
            if block.get('type') == 'text':
                found = continuation_result(block.get('text'))
                if found:
                    return found
    candidates = [value.get('continuation')]
    candidates += [r.get('continuation') for r in value.get('results', []) if isinstance(r, dict)]
    continuations = [c for c in candidates if isinstance(c, dict)]
    return next((c for c in continuations if c.get('owner') == 'agent'), continuations[0] if continuations else None)


def workflow_metadata(value):
    if isinstance(value, str):
        try: value = json.loads(value.removeprefix('Error: '))
        except ValueError: return None
    if not isinstance(value, dict): return None
    if isinstance(value.get('workflowContract'), dict): return value['workflowContract']
    for name in ('result', 'data', 'structuredContent', 'output'):
        found = workflow_metadata(value.get(name))
        if found: return found
    for block in value.get('content', []):
        if isinstance(block, dict) and block.get('type') == 'text':
            found = workflow_metadata(block.get('text'))
            if found: return found
    return None


def handle_continuation(event):
    session, turn = event.get('session_id'), event.get('turn_id')
    if not session or not turn:
        return {}
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    file = STATE / ('continuation-' + key(session, turn) + '.json')
    try:
        old = json.loads(file.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        old = {}
    if event['hook_event_name'] == 'PostToolUse':
        tool = event.get('tool_name', '')
        value = event.get('tool_response', event.get('tool_result', event.get('output')))
        declared = workflow_metadata(value)
        if tool.split('__')[-1] not in CONTINUATION_TOOLS and not (declared and declared.get('tracked') is True and recruiting_tool(tool)):
            return {}
        result = continuation_result(value)
        if not result:
            return {}
        # Store only fixed routing metadata, never form values or website text.
        route = {k: result.get(k) for k in ['state', 'owner', 'requiresUser', 'shouldContinue', 'nextTools', 'reason', 'handoffVerified']}
        fingerprint = hashlib.sha256(json.dumps(route, sort_keys=True).encode()).hexdigest()
        write_atomic(file, {**route, 'fingerprint': fingerprint,
                            'reminded': old.get('reminded', False) if old.get('fingerprint') == fingerprint else False})
        return {}
    if old.get('owner') == 'agent' and old.get('shouldContinue'):
        write_atomic(file, {**old, 'reminded': True, 'stopAttempts': old.get('stopAttempts', 0) + 1})
        return {'decision': 'block', 'reason': '当前 MCP 仍有 Agent 待处理的建库、映射或修复步骤，不能结束或报告完成。请执行已返回的 nextTools；没有证据/输入变化不得盲重试。真实技术阻塞请用 workflow_handoff 提供MCP错误或驱动缺口证据交给监督者，complete仍为false；只有已核实的用户等待、完整核验审阅或技术交接才允许停下，不能要求用户重复回复“继续”。'}
    return {}


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
    if name not in INJECT | {'PreToolUse', 'PostToolUse', 'Stop'}:
        return {}
    if name in {'PostToolUse', 'Stop'}:
        return handle_continuation(event)
    tool = event.get('tool_name', '')
    if name == 'PreToolUse' and recruiting_tool(tool) and tool.split('__')[-1] in LIFECYCLE['stages']:
        # Establish pending work before SDK validation. Invalid arguments may
        # bypass MCP handlers, but cannot erase an actual attempted stage.
        handle_continuation({**event, 'hook_event_name': 'PostToolUse', 'tool_response': {'continuation': {'state': 'tool_pending', 'owner': 'agent', 'requiresUser': False, 'shouldContinue': True, 'nextTools': [tool.split('__')[-1]], 'reason': 'STAGE_RESULT_REQUIRED'}}})
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
