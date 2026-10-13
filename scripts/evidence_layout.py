"""Folder layout and record parsing for 投递证据/ (no JSON ledger).

Layout under the application root (投递根目录):

  投递证据/<批次>/
    批次/Query.md            Query answers, one `## 节` per must-ask item, each with `依据:` → a 确认记录 file
    批次/收尾.md             stop reason and retained pages (closeout)
    确认记录/*.md            the user's own words and time for every confirmation
    公司/<公司>/             数量规则.md 次序确认.md 通道.md [选岗确认.md 首次提交后读回.md 受阻.md]
    岗位/<公司>-<链接码>/    岗位包.md 资格核对.md [尝试指令.md] 填写读回.* 草稿读回.*|无草稿说明.md
                              审核包.md 批准.md 提交前复核.md 目标确认.md 回执.*|结果不确定.md
                              追踪表读回.md [受阻.md]

Records are Markdown with `键: 值` lines (full-width colon allowed) under `## 节` headings.
State (盘点状态 / 投递状态 / 备注) lives only in the Excel tracker.
"""
import hashlib
import re
from pathlib import Path

from workbook_state import canonical_url

EVIDENCE_DIR = '投递证据'
UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
KV = re.compile(r'^\s*(?:[-*]\s*)?([^:：#|\n][^:：\n]{0,40}?)\s*[:：]\s*(.*?)\s*$')


def safe_name(name):
    cleaned = UNSAFE.sub('_', str(name)).strip().rstrip('.')
    return cleaned or '_'


def url_code(url):
    return hashlib.sha1(canonical_url(url).encode('utf-8')).hexdigest()[:8]


def batch_dir(root, batch_id):
    return Path(root) / EVIDENCE_DIR / safe_name(batch_id)


def company_dir(root, batch_id, company):
    return batch_dir(root, batch_id) / '公司' / safe_name(company)


def role_dir(root, batch_id, company, url):
    return batch_dir(root, batch_id) / '岗位' / (safe_name(company) + '-' + url_code(url))


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def find(folder, stem):
    """Files named <stem> or <stem>.<ext> (e.g. 回执.png, 回执.md)."""
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and (p.name == stem or p.stem == stem))


def read_text(path):
    try:
        return Path(path).read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        return ''


def parse(path):
    """Return {'': {...}, '节名': {...}} key-values plus raw lines per section."""
    sections, lines = {'': {}}, {'': []}
    current = ''
    in_code = False
    for line in read_text(path).splitlines():
        if line.strip().startswith('```'):
            in_code = not in_code
            continue
        if in_code:
            continue
        heading = re.match(r'^#{1,6}\s+(.+?)\s*$', line)
        if heading:
            current = heading.group(1).strip()
            sections.setdefault(current, {}); lines.setdefault(current, [])
            continue
        lines[current].append(line)
        m = KV.match(line)
        if m and not line.lstrip().startswith('|'):
            sections[current].setdefault(m.group(1).strip(), m.group(2).strip())
    return sections, lines


def value(sections, key, section=None):
    """First value for key in the given section, or anywhere when section is None."""
    if section is not None:
        return sections.get(section, {}).get(key, '')
    for kv in sections.values():
        if kv.get(key):
            return kv[key]
    return ''


def list_items(lines):
    """`- 项 | 列 | 列` bullets in a section, split on |."""
    items = []
    for line in lines:
        m = re.match(r'^\s*[-*]\s+(.+?)\s*$', line)
        if m and ('|' in m.group(1) or not KV.match(line)):
            items.append([part.strip() for part in m.group(1).split('|')])
    return items


def ref_exists(root, ref):
    """A reference is a path relative to the application root, inside 投递证据/."""
    ref = (ref or '').strip().strip('`').replace('\\', '/')
    if ref.startswith('file:'):
        ref = ref[5:]
    if not ref or ref.startswith('/') or ':' in ref.split('/')[0]:
        return False
    base = Path(root).resolve()
    target = (base / ref).resolve()
    evidence = (base / EVIDENCE_DIR).resolve()
    return evidence in target.parents and target.is_file()
