"""Submit pass: the link between the submit gate and the platform hook.

`stage_gate.py --stage submit` writes 投递证据/门禁通行证.md after the gate allows one role. The
PreToolUse hook (`hooks/application_guard.py`) lets a final-submit-like browser click through only
while the pass is valid and spends one click per use. A pass covers one role for 10 minutes and
3 clicks (the submit button plus the site's confirmation modal). It is void as soon as that role's
evidence folder holds a receipt (回执.*) or an uncertain-result record (结果不确定.md).
Every allowed click also writes 提交已点击.md into the role folder (see mark_clicked).
"""
import datetime
from pathlib import Path

from evidence_layout import parse, value

PASS_FILE = '门禁通行证.md'
CLICKED_FILE = '提交已点击.md'
EVIDENCE_DIR = '投递证据'
VALID_MINUTES = 10
CLICKS = 3


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def pass_path(root):
    return Path(root) / EVIDENCE_DIR / PASS_FILE


def issue_submit_pass(root, batch_id, url, role_folder, minutes=VALID_MINUTES, clicks=CLICKS):
    issued = now()
    folder = Path(role_folder).resolve()
    base = Path(root).resolve()
    record = {'批次': batch_id, '岗位链接': url,
              '岗位目录': folder.relative_to(base).as_posix() if base in folder.parents else str(folder),
              '签发': issued.isoformat(timespec='seconds'),
              '到期': (issued + datetime.timedelta(minutes=minutes)).isoformat(timespec='seconds'),
              '剩余点击': str(clicks), '使用记录': ''}
    write(root, record)
    return {'文件': EVIDENCE_DIR + '/' + PASS_FILE, '岗位目录': record['岗位目录'], '到期': record['到期'], '点击次数': clicks}


def write(root, record):
    path = pass_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = '# 提交通行证\n\n' + ''.join(k + ': ' + str(v) + '\n' for k, v in record.items())
    path.write_text(body, encoding='utf-8')


def read(root):
    kv, _ = parse(pass_path(root))
    return {k: value(kv, k) for k in ('批次', '岗位链接', '岗位目录', '签发', '到期', '剩余点击', '使用记录')}


def role_done(root, record):
    folder = Path(record['岗位目录'])
    folder = folder if folder.is_absolute() else Path(root) / folder
    if not folder.is_dir():
        return 'role folder missing'
    names = {p.stem for p in folder.iterdir() if p.is_file()}
    if '回执' in names:
        return 'receipt recorded'
    if '结果不确定' in names:
        return 'result uncertain'
    return None


def consume_submit_click(root):
    """Spend one click from a valid pass. Returns (allowed, message)."""
    path = pass_path(root)
    if not path.is_file():
        return False, 'no submit pass'
    try:
        record = read(root)
        expires = datetime.datetime.fromisoformat(record['到期'])
        left = int(record['剩余点击'])
        if not record['岗位目录']:
            raise ValueError('no role folder')
        done = role_done(root, record)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False, 'submit pass unreadable'
    if expires <= now():
        return False, 'submit pass expired at ' + record['到期']
    if left <= 0:
        return False, 'submit pass already used'
    if done:
        return False, 'submit pass void: ' + done + ' for ' + str(record.get('岗位目录'))
    stamp = now().isoformat(timespec='seconds')
    record['剩余点击'] = str(left - 1)
    record['使用记录'] = (record['使用记录'] + ' ' + stamp).strip()
    write(root, record)
    mark_clicked(root, record, stamp)
    return True, 'submit pass for ' + str(record.get('岗位目录')) + ' (' + str(left - 1) + ' clicks left)'


def mark_clicked(root, record, stamp):
    """Leave 提交已点击.md in the role folder before the click happens.

    If the session dies between the click and recording the receipt, the folder still shows that a
    submission may have gone out, so every gate refuses a new pass until the application center is
    checked and a receipt or 结果不确定.md is saved.
    """
    folder = Path(record['岗位目录'])
    folder = folder if folder.is_absolute() else Path(root) / folder
    path = folder / CLICKED_FILE
    head = '' if path.is_file() else ('# 提交已点击\n\n批次: ' + str(record.get('批次')) + '\n岗位链接: ' + str(record.get('岗位链接')) +
                                      '\n说明: 钩子放行了最终提交点击；没有回执或 结果不确定.md 之前，先查申请中心，不再点击提交。\n\n')
    with path.open('a', encoding='utf-8') as handle:
        handle.write(head + '- 点击: ' + stamp + '\n')
