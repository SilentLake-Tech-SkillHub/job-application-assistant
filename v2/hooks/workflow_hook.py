#!/usr/bin/env python3
"""Conversation-scoped short call route; execution facts are checked inside MCP."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid
import shlex
sys.path.insert(0, str(Path(__file__).resolve().parent))
from conversation_scope import host_role, read_active_scope
from skill_route import route_text

ROOT = Path(os.environ['RECRUITING_WORKSPACE_ROOT']).resolve()
POLICY = Path(os.environ['RECRUITING_WORKFLOW_POLICY'])
LOCK = Path(os.environ['RECRUITING_WORKFLOW_LOCK'])
STATE = Path(os.environ['RECRUITING_WORKFLOW_STATE'])
SCOPE = Path(os.environ['RECRUITING_WORKFLOW_SCOPE'])
INJECT = {'UserPromptSubmit', 'SessionStart', 'SubagentStart'}
LEGACY_CONTINUATION_TOOLS = {'workflow_next', 'form_route', 'workflow_advance', 'role_prepare', 'prepare_plan', 'batch_prepare', 'role_verify', 'verify_current', 'capture_rea_structure', 'capture_controls', 'form_mapping_candidates', 'capture_choice_options', 'form_build_template', 'template_register', 'probe_conditions', 'template_finalize', 'profile_map_questions', 'material_import_prepare', 'material_import_run', 'roles_prepare_batch', 'roles_patch_text', 'workflow_handoff'}

LIFECYCLE = json.loads((Path(__file__).resolve().parents[1] / 'catalog/workflow-tools.json').read_text(encoding='utf-8'))
CONTINUATION_TOOLS = set(LIFECYCLE['stages']) | LEGACY_CONTINUATION_TOOLS

def _load_tool_arguments():
    # The one shared definition of text-only host tools and file argument names (hooks/tool-arguments.json).
    # Missing or unreadable: no tool counts as text-only, so everything is checked as a file operation.
    try:
        spec = json.loads(Path(__file__).with_name('tool-arguments.json').read_text(encoding='utf-8'))
        return {t.lower() for t in spec['textTools']}, set(spec['fileArgumentKeys'])
    except (OSError, ValueError, KeyError, TypeError):
        return set(), set()

TEXT_TOOLS, FILE_ARGUMENT_KEYS = _load_tool_arguments()

def _has_file_argument(value):
    if isinstance(value, dict):
        return any(k in FILE_ARGUMENT_KEYS or _has_file_argument(v) for k, v in value.items())
    if isinstance(value, list):
        return any(_has_file_argument(v) for v in value)
    return False

def text_only(kind, args):
    return kind in TEXT_TOOLS and isinstance(args, dict) and not _has_file_argument(args)

def recruiting_tool(tool):
    return 'recruiting_application_v2' in tool.replace('-', '_') or 'recruiting_login_v2' in tool.replace('-', '_')


def source_read_allowed(value):
    target = Path(value)
    if not target.is_absolute():
        target = ROOT / target
    target = target.resolve()
    package = Path(__file__).resolve().parents[1]
    return (target in {ROOT / name for name in ('AGENTS.md', '产品管理/求职目标.json',
            '产品管理/求职配置.md', '产品管理/MCP固定执行指令.md')} or
            target.suffix in {'.md', '.py', '.mjs', '.json'} and package in target.parents)


def component_cli_event(event, *, anchor_only=False):
    """Normalize the installed fixed CLI into the same workflow Hook path."""
    kind = event.get('tool_name', '').split('__')[-1].lower()
    if kind not in {'bash', 'exec_command', 'execute', 'shell'}:
        return event
    args = event.get('tool_input') or event.get('arguments') or {}
    if not isinstance(args, dict):
        return event
    command = args.get('command', args.get('cmd', ''))
    if any(c in command for c in ('\n', '\r', ';', '|', '&', '`', '$', '>', '<')):
        return event
    try:
        parts = shlex.split(command)
        if anchor_only:
            prefix = {}
            while parts and re.fullmatch(r'(?:RECRUITING_[A-Z0-9_]+|CODEX_THREAD_ID|CODEX_SESSION_ID|CLAUDE_SESSION_ID|DSH_SESSION_ID)=.*', parts[0]):
                variable, value = parts.pop(0).split('=', 1)
                if variable in prefix:
                    return event
                prefix[variable] = value
            ids = {prefix[name] for name in ('CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'DSH_SESSION_ID') if name in prefix}
            if not prefix or '--stage-dir' not in parts or ids and ids != {event.get('session_id')}:
                return event
        cli = Path(__file__).resolve().parents[1] / 'scripts/cli.mjs'
        updater = cli.with_name('update-runtime.mjs')
        if len(parts) in {2, 3} and Path(parts[0]).name == 'node' and Path(parts[1]).resolve() == updater and (len(parts) == 2 or parts[2] == '--preview'):
            return {**event, 'tool_name': 'mcp__recruiting_application_v2__component_runtime', 'tool_input': {'action': 'update'}, 'component_cli': True}
        if len(parts) < 4 or Path(parts[0]).name != 'node' or Path(parts[1]).resolve() != cli:
            return event
        tail = parts[2:]
        if '--workspace' in tail:
            i = tail.index('--workspace')
            if Path(tail[i+1]).resolve() != ROOT:
                return event
            del tail[i:i+2]
        if '--stage-dir' in tail:
            i = tail.index('--stage-dir')
            if not Path(tail[i+1]).is_absolute() or not Path(tail[i+1]).name.startswith('recruiting-host-stage-'):
                return event
            del tail[i:i+2]
        if len(tail) not in {2, 3} or tail[0] not in {'login', 'application'}:
            return event
        mode, operation = tail[:2]
        operation = {'runtime': 'component_runtime', 'list': 'runtime_info'}.get(operation, operation)
        if operation not in set(LIFECYCLE['inspections']) | set(LIFECYCLE['stages']):
            return event
        payload = json.loads(Path(tail[2]).read_text()) if len(tail) == 3 else {}
        return {**event, 'tool_name': 'mcp__recruiting_'+mode+'_v2__'+operation, 'tool_input': payload, 'component_cli': True}
    except (ValueError, IndexError, OSError):
        return event


def main_chrome_tool_allowed(event):
    tool = event.get('tool_name', '').lower().replace('-', '_')
    if not any(name in tool for name in ('cua_repl', 'claude_in_chrome', 'webbridge')):
        return False
    try:
        settings = json.loads((ROOT / '产品管理/浏览器设置.json').read_text())
        registry = json.loads((ROOT / '产品管理/Agent浏览器兜底登记.json').read_text())
        host = os.environ.get('RECRUITING_HOST_ID')
        return settings.get('choice') == 'main' and any(a.get('hostId') == host and 'chrome_main_extension' in a.get('浏览器', []) for a in registry.get('agents', []))
    except (OSError, ValueError):
        return False


def executor_boundary(event):
    """Enabled execution sessions may operate websites only through this MCP.

    Read-only Skill/source loading remains available. Shell programs, browser
    tools and file writes cannot become an alternative application engine.
    Maintenance conversations are deliberately outside this execution scope.
    """
    if main_chrome_tool_allowed(event):
        return None
    tool = event.get('tool_name', '')
    if recruiting_tool(tool):
        return
    args = event.get('tool_input') or event.get('arguments') or {}
    if isinstance(args, str):
        try: args = json.loads(args)
        except ValueError: args = {}
    kind = tool.split('__')[-1].lower()
    if text_only(kind, args):
        return
    if not isinstance(args, dict):
        args = {}
    if kind == 'view_image' and isinstance(args.get('path'), str) and Path(args['path']).is_absolute():
        return  # Read a saved MCP screenshot; this does not operate the browser.
    if kind in {'read', 'read_file', 'readfile'}:
        value = next((args.get(key) for key in ('filePath', 'file_path', 'path') if args.get(key)), None)
        if value and source_read_allowed(value):
            return
    if kind in {'bash', 'exec_command', 'execute', 'shell'}:
        command = args.get('command', args.get('cmd', ''))
        try: parts = shlex.split(command)
        except ValueError: parts = []
        # Hosts without a dedicated read-file tool still need to load the Skill.
        simple = not any(character in command for character in ('\n', '\r', ';', '|', '&', '`', '$', '>', '<'))
        if (simple and len(parts) >= 2 and parts[0] in {'cat', '/bin/cat', '/usr/bin/cat'} and
                all(not p.startswith('-') and source_read_allowed(p) for p in parts[1:])):
            return
        bootstrap = Path(__file__).resolve().with_name('conversation_scope.py')
        if (len(parts) >= 3 and Path(parts[0]).name in {'python3', 'python', Path(sys.executable).name} and
                Path(parts[1]).resolve() == bootstrap and parts[2] in {'enable', 'disable'} and
                simple):
            return
    raise ValueError('EXECUTOR_MCP_ONLY: 网站采集、映射、建库、填写、读回只允许 recruiting-login-v2 / recruiting-application-v2 或组件固定 CLI；插件缺陷请 workflow_handoff，禁止浏览器工具、脚本或直接修改运行资产替代插件')


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


def record_hook_reference(session, receipt):
    if not session or not receipt:
        return
    file = STATE / ('hook-session-' + hashlib.sha256(session.encode()).hexdigest()[:24] + '.json')
    STATE.mkdir(parents=True, exist_ok=True)
    value = {'receipt': receipt.name}
    try:
        if json.loads(file.read_text()) == value:
            return
    except (OSError, ValueError):
        pass
    write_atomic(file, value)


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
    if 'agentWorkRemaining' in value:
        actionable = value.get('actionable') or []
        return {'state': 'prepare' if actionable else 'review', 'owner': 'agent' if actionable else 'user',
                'shouldContinue': bool(actionable), 'requiresUser': not bool(actionable),
                'nextTools': list(dict.fromkeys(item.get('nextTool', 'role_advance') for item in actionable)), 'pollAfterMs': value.get('pollAfterMs', 0)}
    candidates = [value.get('continuation')]
    candidates += [r.get('continuation') for r in value.get('results', []) if isinstance(r, dict)]
    continuations = [c for c in candidates if isinstance(c, dict)]
    result = next((c for c in continuations if c.get('owner') == 'agent'), continuations[0] if continuations else None)
    if result and result.get('owner') == 'supervisor' and result.get('handoffVerified') and not result.get('requiresUser'):
        return {**result, 'state': 'repair', 'owner': 'agent', 'repairOwner': 'supervisor',
                'shouldContinue': True, 'nextTools': ['run_status']}
    return result


def continuation_reference(session):
    return STATE / ('continuation-session-' + hashlib.sha256(session.encode()).hexdigest()[:24] + '.json')


def save_continuation(file, value, session, turn):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_atomic(file, {**value, 'session_id': session, 'turn_id': turn})
    write_atomic(continuation_reference(session), {'receipt': file.name})


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


def cli_work_for_turn(session, turn):
    folder = STATE / ('cli-continuation-' + key(session, turn))
    records = []
    try:
        files = list(folder.iterdir())
    except OSError:
        return records
    for file in files:
        if len(file.name) != 64 or any(c not in '0123456789abcdef' for c in file.name):
            continue
        try:
            item = json.loads(file.read_text())
            route = item.get('route') or {}
            if (item.get('session_id') == session and item.get('turn_id') == turn
                    and isinstance(item.get('scope'), str) and isinstance(item.get('atMs'), int)
                    and route.get('owner') in ('agent', 'user', 'supervisor', 'maintainer')
                    and isinstance(route.get('shouldContinue'), bool)):
                records.append(item)
        except (OSError, ValueError, AttributeError):
            pass
    return records


def merge_cli_continuation(old, receipts):
    if not receipts:
        return old
    work = dict(old.get('workByScope') or {})
    dates = dict(old.get('workAtMsByScope') or {})
    batch_at = old.get('batchAtMs', 0)
    for item in sorted(receipts, key=lambda record: record['atMs']):
        stamp, scope = item['atMs'], item['scope']
        if item['batch']:
            if stamp < batch_at:
                continue
            work = {k: v for k, v in work.items() if dates.get(k, 0) > stamp}
            dates = {k: dates[k] for k in work}
            batch_at = stamp
        if stamp < batch_at or stamp < dates.get(scope, 0):
            continue
        route = continuation_result({'continuation': item['route']})
        work[scope], dates[scope] = route, stamp
    if not work:
        return old
    pending = [r for r in work.values() if r.get('owner') == 'agent' and r.get('shouldContinue')]
    route = pending[0] if pending else max(work.items(), key=lambda pair: dates.get(pair[0], 0))[1]
    return {**old, **route, 'workByScope': work, 'workAtMsByScope': dates,
            'batchAtMs': batch_at,
            'observedEvents': list(dict.fromkeys([*(old.get('observedEvents') or []), 'ComponentCLI']))}


def handle_continuation(event):
    session, turn = event.get('session_id'), event.get('turn_id')
    if not session or not turn:
        return {}
    file = STATE / ('continuation-' + key(session, turn) + '.json')
    try:
        old = json.loads(file.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        old = {}
    # A Stop continuation is a fresh Codex turn. Preserve its pending work
    # instead of treating the new turn's empty receipt as permission to finish.
    if not old and event.get('stop_hook_active'):
        try:
            name = json.loads(continuation_reference(session).read_text())['receipt']
            if Path(name).name == name:
                prior = json.loads((STATE / name).read_text())
                if prior.get('session_id') == session:
                    old = prior
        except (OSError, ValueError, KeyError):
            pass
    if event['hook_event_name'] == 'PostToolUse':
        tool = event.get('tool_name', '')
        value = event.get('tool_response', event.get('tool_result', event.get('output')))
        declared = workflow_metadata(value)
        batch_status = tool.split('__')[-1] == 'company_batch_status'
        if batch_status and not old and not continuation_reference(session).exists():
            try:
                active = session in read_active_scope(SCOPE).get('session_ids', [])
            except (OSError, ValueError):
                active = False
            if not active:
                return {}
        if not batch_status and tool.split('__')[-1] not in CONTINUATION_TOOLS and not (declared and declared.get('tracked') is True and recruiting_tool(tool)):
            return {}
        result = continuation_result(value)
        if not result:
            return {}
        # Store only fixed routing metadata, never form values or website text.
        route = {k: result.get(k) for k in ['state', 'owner', 'requiresUser', 'shouldContinue', 'nextTools', 'reason', 'handoffVerified']}
        inputs = event.get('tool_input') or event.get('arguments') or {}
        if not isinstance(inputs, dict):
            inputs = {}
        scope = inputs.get('taskId') or inputs.get('companyId') or 'batch'
        work = {} if batch_status else dict(old.get('workByScope') or {})
        work[scope] = route
        at_ms = time.time_ns() // 1_000_000
        dates = {} if batch_status else dict(old.get('workAtMsByScope') or {})
        dates[scope] = at_ms
        pending = [item for item in work.values() if item.get('owner') == 'agent' and item.get('shouldContinue')]
        if pending:
            route = {**pending[0], 'requiresUser': False}
        fingerprint = hashlib.sha256(json.dumps(route, sort_keys=True).encode()).hexdigest()
        observed = list(dict.fromkeys([*(old.get('observedEvents') or []),
                        'PreToolUse' if event.get('stage_attempt') else 'PostToolUse']))
        save_continuation(file, {**route, 'workByScope': work, 'fingerprint': fingerprint,
                            'reminded': False, 'stopAttempts': 0,
                            'observedEvents': observed, 'workAtMsByScope': dates,
                            'batchAtMs': at_ms if batch_status else old.get('batchAtMs', 0),
                            'receiptRevision': old.get('receiptRevision', 0) + 1,
                            'lastTool': tool.split('__')[-1]}, session, turn)
        return {}
    old = merge_cli_continuation(old, cli_work_for_turn(session, turn))
    if old.get('owner') == 'agent' and old.get('shouldContinue'):
        attempts = old.get('stopAttempts', 0) + 1
        observed = list(dict.fromkeys([*(old.get('observedEvents') or []), 'Stop']))
        save_continuation(file, {**old, 'reminded': True, 'stopAttempts': attempts,
                                'observedEvents': observed}, session, turn)
        return {'decision': 'block', 'reason': '当前整批仍有 Agent 待处理的建库、映射、技术修复或原任务恢复，继续执行，不能结束或报告完成。先处理已返回的nextTools；遇到技术缺口实际接入已授权维护流程，修复重载后从原任务恢复，其他公司继续。workflow_handoff只登记待修证据，不授予收工权限。没有证据或输入变化不得盲重试，也不能要求用户重复回复“继续”。'}
    return {}


def handle(event):
    started = time.perf_counter()
    cwd = Path(event.get('cwd') or ROOT).resolve()
    if (cwd != ROOT and ROOT not in cwd.parents) or host_role() == 'maintainer':
        return {}
    literal_cli = component_cli_event(event, anchor_only=True)
    event = component_cli_event(event)
    name = event.get('hook_event_name')
    tool = event.get('tool_name', '')
    operation = tool.split('__')[-1]
    session, turn = event.get('session_id'), event.get('turn_id')
    receipt = STATE / (key(session, turn) + '.json') if session and turn else None

    anchor_tool = literal_cli.get('tool_name', '') if literal_cli.get('component_cli') else tool
    anchor_operation = anchor_tool.split('__')[-1]
    tracks_work = anchor_operation in LIFECYCLE['stages'] or anchor_operation == 'company_batch_status'
    anchors_cli = name == 'UserPromptSubmit' or (name in {'PreToolUse', 'PostToolUse'} and recruiting_tool(anchor_tool) and tracks_work)
    if anchors_cli and session and turn:
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        mark = hashlib.sha256(session.encode()).hexdigest()[:24]
        anchor = STATE / ('host-turn-' + mark + '.json')
        current = {'session_id': session, 'turn_id': turn}
        try:
            previous = json.loads(anchor.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            previous = None
        if previous != current:
            write_atomic(anchor, current)

    if name == 'Stop':
        return handle_continuation(event)
    if name == 'PostToolUse':
        return handle_continuation(event) if recruiting_tool(tool) else {}
    if name not in INJECT | {'PreToolUse'}:
        return {}

    stage = name == 'PreToolUse' and recruiting_tool(tool) and operation in LIFECYCLE['stages']
    # A business call is itself the entry point. No conversation registration
    # or previous diagnostic result is needed to reach the checked core.
    if not stage:
        try:
            active = session in read_active_scope(SCOPE).get('session_ids', [])
        except (OSError, ValueError):
            active = False
        if not active:
            return {}
        if name == 'PreToolUse':
            if tool.startswith('mcp__recruiting_form__'):
                raise ValueError('V2_RUNTIME_REQUIRED_USE_RECRUITING_APPLICATION_V2')
            executor_boundary(event)
            if not recruiting_tool(tool) or operation != 'runtime_info':
                return {}

    sha = hashlib.sha256(POLICY.read_bytes()).hexdigest()
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    # 注入内容由 SKILL.md 环节表生成（C38），锁文件 route_sha256 对生成结果取值。
    route = route_text()
    route_sha = hashlib.sha256(route.encode('utf-8')).hexdigest()
    if lock.get('route_sha256') and route_sha != lock['route_sha256']:
        raise ValueError('WORKFLOW_ROUTE_HASH_CHANGED')
    if sha != lock['sha256']:
        raise ValueError('WORKFLOW_INSTRUCTION_HASH_CHANGED')

    if stage:
        # Invalid SDK arguments may bypass the component. Track this attempt
        # for Stop without using the continuation record to authorize calls.
        pending = {'state': 'tool_pending', 'owner': 'agent', 'requiresUser': False,
                   'shouldContinue': True, 'nextTools': [operation], 'reason': 'STAGE_RESULT_REQUIRED'}
        handle_continuation({**event, 'hook_event_name': 'PostToolUse',
                             'stage_attempt': True,
                             'tool_response': {'continuation': pending}})
    current = {'session_id': session, 'turn_id': turn, 'sha256': sha, 'route_sha256': route_sha}
    if receipt and name not in INJECT:
        try:
            loaded = json.loads(receipt.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            loaded = {}
        if all(loaded.get(k) == v for k, v in current.items()):
            record_hook_reference(session, receipt)
            return {}

    context = ('本轮求职调用入口；后续用户明确修改及上级指令优先。\n'
               '版本：' + lock['version'] + '；SHA256：' + sha + '\n'
               '速度要求不放宽；Hook与监督开销均计入用户视角总耗时。\n\n' + route)
    if receipt:
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        write_atomic(receipt, {**current, 'event': name, 'at': time.time()})
        record_hook_reference(session, receipt)
        record = {**current, 'event': name, 'instruction_bytes': len(route.encode('utf-8')),
                  'elapsed_ms': round((time.perf_counter() - started) * 1000, 3), 'at': time.time()}
        fd = os.open(STATE / 'injections.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'a', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
    return {'hookSpecificOutput': {'hookEventName': name, 'additionalContext': context}}


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
