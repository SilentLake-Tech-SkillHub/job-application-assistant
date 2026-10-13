"""Submit pass and submit-attempt markers: the link between the submit gate and the platform hook.

`stage_gate.py --stage submit` writes 投递证据/门禁通行证.md after the gate allows one role. The
PreToolUse hook (`hooks/application_guard.py`) lets final-submit-like browser clicks through only
while the pass is valid:

* one pass = one role, 10 minutes, 3 clicks: **one initial submit** plus at most two clicks on the
  site's confirmation dialog. An initial submit cannot be replayed on the same pass, and a
  confirmation click is only allowed after that pass's initial submit.
* Before the initial click is released the hook writes 提交已点击.md (with the pass ID) into the
  role folder. If the session dies between the click and recording the result, the marker stays:
  every gate refuses to issue a new pass until the application center has been checked —
  a receipt (回执.*), an uncertain record (结果不确定.md), or a fresh 提交核查.md that proves the
  click did NOT go through (then a retry is allowed and the old marker is archived to 提交尝试/).
* The pass is void as soon as the role folder holds a receipt or 结果不确定.md.
* Hook calls are serialized with a lock file so two simultaneous clicks cannot both spend it.
"""
import datetime
import os
import tempfile
import time
import uuid
from pathlib import Path

from evidence_layout import parse, value, file_hash, ref_exists, parse_time
from workbook_state import canonical_url

PASS_FILE = '门禁通行证.md'
CLICKED_FILE = '提交已点击.md'
CHECK_FILE = '提交核查.md'
ARCHIVE_DIR = '提交尝试'
EVIDENCE_DIR = '投递证据'
VALID_MINUTES = 10
CLICKS = 3
CHECK_HOURS = 24
LOCK_STALE_SECONDS = 30


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def pass_path(root):
    return Path(root) / EVIDENCE_DIR / PASS_FILE


def atomic_write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ---------------------------------------------------------------- attempts
def role_done(folder):
    folder = Path(folder)
    if not folder.is_dir():
        return 'role folder missing'
    names = {p.stem for p in folder.iterdir() if p.is_file()}
    if '回执' in names:
        return 'receipt recorded'
    if '结果不确定' in names:
        return 'result uncertain'
    return None


def check_errors(root, folder):
    """Why 提交核查.md does not (yet) prove that the released click did not submit."""
    folder = Path(folder)
    marker, check = folder / CLICKED_FILE, folder / CHECK_FILE
    if not check.is_file():
        return ['没有 ' + CHECK_FILE]
    kv, _ = parse(check)
    marker_kv, _ = parse(marker)
    errors = []
    if value(kv, '标记哈希') != file_hash(marker):
        errors.append(CHECK_FILE + ' 的「标记哈希」不是当前 ' + CLICKED_FILE + ' 的 SHA-256')
    if value(kv, '结论') != '未提交':
        errors.append(CHECK_FILE + ' 的「结论」不是「未提交」（查到已提交就存回执入账；查不清写 结果不确定.md）')
    checked, clicked = parse_time(value(kv, '核验时间')), parse_time(value(marker_kv, '点击放行时间'))
    if checked is None or clicked is None:
        errors.append(CHECK_FILE + ' 需要「核验时间:」（ISO 时间，晚于点击放行时间）')
    else:
        age = now() - checked
        if checked < clicked:
            errors.append(CHECK_FILE + ' 的核验早于点击，不能证明点击后的结果')
        if age > datetime.timedelta(hours=CHECK_HOURS) or age < -datetime.timedelta(minutes=10):
            errors.append(CHECK_FILE + ' 已超过 %d 小时或时间在未来：重新查申请中心' % CHECK_HOURS)
    if not value(kv, '来源').startswith(('https://', 'http://')):
        errors.append(CHECK_FILE + ' 需要「来源:」申请中心网址')
    if not ref_exists(root, value(kv, '证据')):
        errors.append(CHECK_FILE + ' 的「证据:」必须指向 投递证据/ 下这次核查的截图或读回文件')
    return errors


def unresolved_attempt(root, folder):
    """True when a released submit click has not been reconciled with the application center."""
    folder = Path(folder)
    if not (folder / CLICKED_FILE).is_file():
        return False
    if role_done(folder):
        return False  # receipt / uncertain-result protections take over
    return bool(check_errors(root, folder))


def attempts(root):
    """Every 提交已点击.md under 投递证据/ (all batches): (folder, canonical url, unresolved)."""
    base = Path(root) / EVIDENCE_DIR
    found = []
    if base.is_dir():
        for marker in base.glob('*/岗位/*/' + CLICKED_FILE):
            kv, _ = parse(marker)
            found.append((marker.parent, canonical_url(value(kv, '岗位链接')), unresolved_attempt(root, marker.parent)))
    return found


# ---------------------------------------------------------------- pass
def issue_submit_pass(root, batch_id, url, role_folder, minutes=VALID_MINUTES, clicks=CLICKS):
    issued = now()
    folder = Path(role_folder).resolve()
    base = Path(root).resolve()
    if base not in folder.parents or not folder.is_dir():
        raise ValueError('岗位目录必须存在且位于投递根目录内')
    if unresolved_attempt(root, folder):
        raise ValueError('已放行过提交点击且结果未核查：先查申请中心，不能重新签发')
    if role_done(folder):
        raise ValueError('已有回执或结果不确定，不能重新签发')
    record = {'批次': batch_id, '岗位链接': url, '岗位目录': folder.relative_to(base).as_posix(),
              '通行证ID': uuid.uuid4().hex, '签发': issued.isoformat(timespec='seconds'),
              '到期': (issued + datetime.timedelta(minutes=minutes)).isoformat(timespec='seconds'),
              '剩余点击': str(clicks), '首次提交': '未放行', '使用记录': ''}
    write(root, record)
    return {'文件': EVIDENCE_DIR + '/' + PASS_FILE, '岗位目录': record['岗位目录'], '到期': record['到期'],
            '点击次数': clicks, '说明': '一次首次提交 + 站点确认弹窗'}


def write(root, record):
    atomic_write(pass_path(root), '# 提交通行证\n\n' + ''.join(k + ': ' + str(v) + '\n' for k, v in record.items()))


def read(root):
    kv, _ = parse(pass_path(root))
    return {k: value(kv, k) for k in ('批次', '岗位链接', '岗位目录', '通行证ID', '签发', '到期', '剩余点击', '首次提交', '使用记录')}


class _Lock:
    def __init__(self, root):
        self.path = pass_path(root).with_name(PASS_FILE + '.lock')
        self.fd = None

    def __enter__(self):
        for _ in range(2):
            try:
                self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > LOCK_STALE_SECONDS:
                        self.path.unlink()  # left behind by an interrupted hook
                        continue
                except OSError:
                    continue
                return None
        return None

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)
            try:
                self.path.unlink()
            except OSError:
                pass


def consume_submit_click(root, confirmation=False):
    """Spend one click from a valid pass. Returns (allowed, message). Serialized by a lock."""
    if not pass_path(root).is_file():
        return False, 'no submit pass'
    with _Lock(root) as lock:
        if lock is None:
            return False, 'submit pass busy: another submit click is being checked'
        return _consume(root, confirmation)


def _consume(root, confirmation):
    try:
        record = read(root)
        expires = datetime.datetime.fromisoformat(record['到期'])
        left = int(record['剩余点击'])
        if not record['岗位目录'] or not record['通行证ID']:
            raise ValueError('incomplete pass')
        base = Path(root).resolve()
        folder = (base / record['岗位目录']).resolve()
        if base not in folder.parents:
            raise ValueError('role folder escapes the application root')
        done = role_done(folder)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False, 'submit pass unreadable'
    if expires <= now():
        return False, 'submit pass expired at ' + record['到期']
    if left <= 0:
        return False, 'submit pass already used'
    if done:
        return False, 'submit pass void: ' + done + ' for ' + record['岗位目录']
    marker = folder / CLICKED_FILE
    stamp = now().isoformat(timespec='seconds')
    same_pass = marker.is_file() and value(parse(marker)[0], '通行证ID') == record['通行证ID']
    if confirmation:
        if not same_pass:
            return False, 'confirmation click needs this pass\'s initial submit first'
    else:
        if same_pass or record['首次提交'] == '已放行':
            return False, 'initial submit already released on this pass; check the application center before any retry'
        if marker.is_file():
            if unresolved_attempt(root, folder):
                return False, 'an earlier submit click is unreconciled; check the application center (提交核查.md) first'
            archive = folder / ARCHIVE_DIR
            archive.mkdir(exist_ok=True)
            tag = uuid.uuid4().hex[:8]
            marker.rename(archive / ('提交已点击-' + tag + '.md'))
            if (folder / CHECK_FILE).is_file():
                (folder / CHECK_FILE).rename(archive / ('提交核查-' + tag + '.md'))
        # Written BEFORE the click is released: a crash can only leave a conservative marker.
        atomic_write(marker, '# 提交已点击\n\n批次: ' + record['批次'] + '\n岗位链接: ' + record['岗位链接'] +
                     '\n通行证ID: ' + record['通行证ID'] + '\n点击放行时间: ' + stamp +
                     '\n含义: 钩子放行了最终提交点击，不证明点击已执行或网站已接收。没有回执或 结果不确定.md 前，'
                     '先查申请中心；确认未提交才写 提交核查.md（标记哈希/结论: 未提交/核验时间/来源/证据）后重试。\n')
        record['首次提交'] = '已放行'
    record['剩余点击'] = str(left - 1)
    record['使用记录'] = (record['使用记录'] + ' ' + ('确认' if confirmation else '首次') + '@' + stamp).strip()
    write(root, record)
    return True, 'submit pass for ' + record['岗位目录'] + ' (' + ('confirmation' if confirmation else 'initial submit') + ', ' + str(left - 1) + ' clicks left)'
