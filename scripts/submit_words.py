"""Shared wording for "this click is a final application submission".

Used by the PreToolUse hook (hooks/application_guard.py) and by the fill executor
(scripts/playwright_fill.py, scripts/fill_plan.py), so a fill plan can never carry a click that the
hook would treat as a submission.
"""
import re

SUBMIT_WORDS = re.compile(r'(提交|投递|我已知晓|确认申请|submit|send application|confirm (?:the )?application|'
                          r'finish application|complete application)', re.I)
NOT_SUBMIT = re.compile(r'(投递记录|投递状态|投递规则|投递须知|投递进度|申请中心|保存草稿|暂存|save draft|draft)', re.I)


def submit_like_text(text):
    """True when the text names a final-submission control (draft saving and history pages excluded)."""
    cleaned = NOT_SUBMIT.sub('', str(text or ''))
    return bool(SUBMIT_WORDS.search(cleaned))
