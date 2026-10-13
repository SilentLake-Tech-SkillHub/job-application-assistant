#!/usr/bin/env python3
"""PreToolUse guard for job-application-assistant (Claude Code / Codex / Kimi Code / GLM via Claude Code).

Blocks a browser action that looks like a final application submission unless
`scripts/stage_gate.py --stage submit --role <role_key>` has just passed and issued a submit pass.

Platform contract shared by Claude Code, Codex and Kimi Code: the hook receives JSON on stdin
with `hook_event_name`, `tool_name`, `tool_input` and `cwd`; exit 0 allows, exit 2 blocks and the
stderr text is returned to the model as the reason.

Scope and limits:
  * Only acts inside an application workspace (a directory with 投递证据/ at or above cwd).
  * Detects submit-like clicks from the tool call's text (button names, element descriptions,
    action summaries). A click given only as screen coordinates carries no text and cannot be
    recognized; the submit gate rule in SKILL.md still applies to it.
  * Fails closed: if a submit-like action is seen and anything goes wrong, it blocks.
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))

EVIDENCE_DIR = '投递证据'
BROWSER_TOOL = re.compile(r'(browser|chrome|playwright|computer|click|navigate|puppeteer|devtools|web_?page)', re.I)
READ_ONLY_TOOL = re.compile(r'(read_page|get_page_text|page_text|snapshot|screenshot|tabs_context|tabs_list|find$|console|network|zoom)', re.I)
CLICK_ACTIONS = {'left_click', 'double_click', 'triple_click', 'click', 'key', 'press', 'tap', 'submit'}
try:
    from submit_words import submit_like_text  # noqa: E402 - shared with the fill executor
except Exception as _exc:  # noqa: BLE001 - keep failing closed on clicks if the Skill copy is broken
    _IMPORT_ERROR = _exc

    def submit_like_text(text):
        raise RuntimeError('submit_words unavailable: ' + type(_IMPORT_ERROR).__name__)


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from strings(value)


def actions(tool_name, tool_input):
    """Each sub-action as (name, input); browser_batch style tools carry several."""
    if isinstance(tool_input, dict) and isinstance(tool_input.get('actions'), list):
        for item in tool_input['actions']:
            if isinstance(item, dict):
                yield str(item.get('name') or tool_name), item.get('input') if isinstance(item.get('input'), dict) else item
    else:
        yield tool_name, tool_input


def is_click(name, data):
    if re.search(r'click|tap|press', name, re.I):
        return True
    if isinstance(data, dict):
        action = str(data.get('action') or data.get('type') or '').lower()
        return action in CLICK_ACTIONS
    return False


def submit_like(tool_name, tool_input):
    # Some hook payloads omit tool_name; then rely on the click action plus submit wording.
    if tool_name and (not BROWSER_TOOL.search(tool_name) or READ_ONLY_TOOL.search(tool_name)):
        return False
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except ValueError:
            tool_input = {'text': tool_input}
    for name, data in actions(tool_name, tool_input):
        if not is_click(name, data):
            continue
        for text in strings(data):
            if submit_like_text(text):
                return True
    return False


CONFIRM_WORDS = re.compile(r'(确认投递|确认申请|确认提交|我已知晓|弹窗|对话框|confirm(?:ation)?\b)', re.I)


def submit_actions(tool_name, tool_input):
    """One entry per submit-like sub-action (a browser_batch can hold several): True = confirmation dialog."""
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except ValueError:
            tool_input = {'text': tool_input}
    for name, data in actions(tool_name, tool_input):
        if submit_like(tool_name, {'actions': [{'name': name, 'input': data}]}):
            yield bool(CONFIRM_WORDS.search(' '.join(strings(data))))


def find_root(start):
    here = Path(start).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / EVIDENCE_DIR).is_dir():
            return candidate
    return None


def block(message):
    sys.stderr.write('[job-application-assistant] 已拦截最终提交：' + message +
                     '。先运行 scripts/stage_gate.py --workbook <追踪表.xlsx> --batch <批次> --stage submit --url <岗位链接>，'
                     '通过后会在 投递证据/门禁通行证.md 发放 10 分钟、3 次点击的提交通行证。\n')
    return 2


def main(raw):
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return 0  # not a hook payload we understand; nothing identifies a submission
    if not isinstance(payload, dict):
        return 0
    event = payload.get('hook_event_name') or payload.get('event') or 'PreToolUse'
    if event != 'PreToolUse':
        return 0
    tool_name = str(payload.get('tool_name') or payload.get('tool') or '')
    tool_input = payload.get('tool_input', payload.get('input', {}))
    try:
        if not submit_like(tool_name, tool_input):
            return 0
    except Exception as exc:  # noqa: BLE001 - classification failure on a browser call: fail closed
        return block('无法判断该操作是否为提交（' + type(exc).__name__ + '）')
    cwd = payload.get('cwd') or os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    try:
        root = find_root(cwd)
        if root is None:
            return 0  # not an application workspace
        from submit_pass import consume_submit_click
        messages = []
        for confirmation in list(submit_actions(tool_name, tool_input)) or [False]:
            allowed, message = consume_submit_click(root, confirmation=confirmation)
            if not allowed:
                return block(message)
            messages.append(message)
    except Exception as exc:  # noqa: BLE001
        return block('提交通行证检查失败（' + type(exc).__name__ + '）')
    sys.stdout.write('[job-application-assistant] ' + '; '.join(messages) + '\n')
    return 0


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')  # Windows consoles default to GBK/cp936
        except (AttributeError, ValueError):
            pass
    try:
        raw = sys.stdin.buffer.read().decode('utf-8', errors='replace')
    except Exception:  # noqa: BLE001
        raw = ''
    sys.exit(main(raw))
