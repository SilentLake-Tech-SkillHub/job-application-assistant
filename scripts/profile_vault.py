#!/usr/bin/env python3
"""Private profile (个人信息档案) helpers: build it from the résumé once, then keep answers in it.

  profile_vault.py init  --resume <简历.pdf|.docx|.txt|.md> --vault <个人信息档案.md> [--text <已提取的纯文本>]
  profile_vault.py check --vault <个人信息档案.md> [--resume <当前简历>]
  profile_vault.py add   --vault <个人信息档案.md> --field <字段> --value <值> [--scope 全部] [--source <用户原话摘要>]
  profile_vault.py has   --vault <个人信息档案.md> --field <字段> [--field …]

* init turns the résumé into plain text (简历文本.md next to the profile) and creates / refreshes the
  profile's 「简历基础信息」 table with the résumé's SHA-256. Mobile number and e-mail are filled
  from the text; the Agent fills the remaining rows by reading the plain text, so later lookups read
  a small Markdown file instead of the PDF. Values the user already wrote are never overwritten.
* check: the profile still matches the current résumé (hash), and holds nothing that must never be
  stored (ID / passport / bank-card numbers, passwords, verification codes, cookies).
* add: writes the user's answer the moment it is given (「网申补充信息」, or updates an existing row
  and logs it in 「变更记录」). Never-store fields are refused. Values are never printed back.
* has: which fields exist (used before moving a fill-plan field from 需用户 back to 待填).

The profile and the résumé text live in the user's private workspace — never in a Skill folder or a
public repository.
"""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fill_plan  # noqa: E402

TEMPLATE = HERE.parent / 'skills' / 'personal-info-vault' / 'assets' / 'profile-template.md'
BASE = '## 简历基础信息'
EXTRA = '## 网申补充信息'
CHANGES = '## 变更记录'
PHONE = re.compile(r'(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d[-\s]?\d{4}[-\s]?\d{4})(?!\d)|(?<!\d)(\+65[-\s]?[689]\d{3}[-\s]?\d{4})(?!\d)')
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
NEVER_VALUE = re.compile(r'(?<!\d)\d{17}[\dXx](?![\dA-Za-z])|(?<!\d)\d{16,19}(?!\d)')


def today():
    return datetime.date.today().isoformat()


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def extract_text(resume):
    """Plain text of the résumé: .txt/.md as is, .docx from its XML, .pdf via pypdf or pdftotext."""
    resume = Path(resume)
    suffix = resume.suffix.lower()
    if suffix in ('.txt', '.md'):
        return resume.read_text(encoding='utf-8', errors='replace')
    if suffix == '.docx':
        with zipfile.ZipFile(resume) as z:
            xml = z.read('word/document.xml').decode('utf-8', errors='replace')
        xml = re.sub(r'</w:p>', '\n', xml)
        return re.sub(r'<[^>]+>', '', xml)
    if suffix == '.pdf':
        try:
            from pypdf import PdfReader
            return '\n'.join((page.extract_text() or '') for page in PdfReader(str(resume)).pages)
        except ImportError:
            pass
        if shutil.which('pdftotext'):
            out = subprocess.run(['pdftotext', '-layout', str(resume), '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
            if out.returncode == 0:
                return out.stdout
        raise ValueError('无法从 PDF 提取文字：安装 pypdf（pip install pypdf）或 pdftotext，或自己导出纯文本后用 --text 传入')
    raise ValueError('不支持的简历格式：' + suffix + '（支持 .pdf .docx .txt .md）')


# ---------------------------------------------------------------- Markdown tables
def section_bounds(lines, heading):
    start = next((i for i, l in enumerate(lines) if l.startswith(heading)), None)
    if start is None:
        return None, None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    return start, end


def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def is_row(line):
    return line.strip().startswith('|') and not set(line.replace('|', '').strip()) <= set('-: ')


def set_row(lines, heading, field, values, overwrite=False):
    """Fill/insert a table row in a section; returns 'new' / 'filled' / 'kept' / 'updated'."""
    start, end = section_bounds(lines, heading)
    if start is None:
        raise ValueError('档案里没有「' + heading[3:] + '」节')
    for i in range(start, end):
        if is_row(lines[i]) and cells(lines[i])[0] == field:
            row = cells(lines[i])
            if row[1] and not overwrite:
                return 'kept', row[1]
            old = row[1]
            row = (row + [''] * len(values))[:max(len(row), len(values) + 1)]
            for j, v in enumerate(values, 1):
                if v is not None:
                    row[j] = v
            lines[i] = '| ' + ' | '.join(row) + ' |'
            return ('updated' if old else 'filled'), old
    last = max([i for i in range(start, end) if lines[i].strip().startswith('|')] or [start])
    lines.insert(last + 1, '| ' + ' | '.join([field] + [v or '' for v in values]) + ' |')
    return 'new', None


def set_kv(lines, heading, key, val):
    start, end = section_bounds(lines, heading)
    for i in range(start, end):
        if re.match(r'^' + re.escape(key) + r'\s*[:：]', lines[i]):
            lines[i] = key + ': ' + val
            return
    lines.insert(start + 1, key + ': ' + val)


# ---------------------------------------------------------------- commands
def init(resume, vault, text_file=None):
    resume, vault = Path(resume), Path(vault)
    text = Path(text_file).read_text(encoding='utf-8', errors='replace') if text_file else extract_text(resume)
    if not text.strip():
        raise ValueError('简历提取出的文字为空（可能是扫描件）：请导出纯文本后用 --text 传入')
    digest = sha256(resume)
    text_path = vault.with_name('简历文本.md')
    vault.parent.mkdir(parents=True, exist_ok=True)
    text_path.write_text('# 简历文本（由 profile_vault.py 生成，私有）\n\n简历文件: ' + resume.name + '\n简历哈希: ' + digest +
                         '\n生成时间: ' + today() + '\n\n```text\n' + text.strip().replace('```', "'''") + '\n```\n', encoding='utf-8')
    if not vault.is_file():
        shutil.copy(TEMPLATE, vault)
    lines = vault.read_text(encoding='utf-8').splitlines()
    if section_bounds(lines, BASE)[0] is None:  # profile made from an older template
        head = next((i for i, l in enumerate(lines) if l.startswith('## ')), len(lines))
        lines[head:head] = [BASE + '（由简历生成，简历换版后重新生成）', '', '| 字段 | 取值 | 来源 | 备注 |', '|---|---|---|---|', '']
    if section_bounds(lines, EXTRA)[0] is None:
        at = section_bounds(lines, CHANGES)[0]
        at = len(lines) if at is None else at
        lines[at:at] = [EXTRA + '（填表时遇到、简历没有的项；用 `profile_vault.py add` 写入）', '| 字段 | 取值 | 适用范围 | 记录日期 | 来源 |', '|---|---|---|---|---|', '']
    for key, val in (('生成时间', today()), ('简历文本', text_path.name), ('简历哈希', digest), ('简历文件', resume.name)):
        set_kv(lines, BASE, key, val)
    found = {}
    phone = PHONE.search(text)
    if phone:
        found['手机号'] = re.sub(r'[-\s]', '', phone.group(1) or phone.group(2))
    email = EMAIL.search(text)
    if email:
        found['邮箱'] = email.group(0)
    filled = {}
    for field, val in found.items():
        state, _ = set_row(lines, BASE, field, [val, '简历自动提取', '请用户核对'])
        filled[field] = state
    vault.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    empty = [cells(l)[0] for l in lines[slice(*section_bounds(lines, BASE))] if is_row(l) and cells(l)[0] != '字段' and not cells(l)[1]]
    return {'通过': True, '档案': str(vault), '简历文本': str(text_path), '简历哈希': digest,
            '自动填入': filled, '待从简历文本补齐': empty,
            '下一步': '读 简历文本.md（不读 PDF）补齐空行；与用户核对自动填入项' if empty else '与用户核对自动填入项'}


def check(vault, resume=None):
    vault = Path(vault)
    errors, warnings = [], []
    if not vault.is_file():
        return {'通过': False, '错误': ['档案不存在：先运行 profile_vault.py init']}
    lines = vault.read_text(encoding='utf-8').splitlines()
    start, end = section_bounds(lines, BASE)
    if start is None:
        errors.append('档案缺「简历基础信息」节：运行 profile_vault.py init 从简历生成')
    else:
        recorded = next((l.split(':', 1)[1].strip() for l in lines[start:end] if l.startswith('简历哈希')), '')
        if resume and recorded != sha256(resume):
            errors.append('简历已更换（哈希不一致）：重新运行 profile_vault.py init，再核对简历基础信息')
        if not recorded:
            errors.append('简历基础信息没有「简历哈希」：重新运行 init')
    for i, line in enumerate(lines, 1):
        if not is_row(line):
            continue
        row = cells(line)
        if len(row) >= 2 and row[1]:
            if fill_plan.NEVER.search(row[0]):
                errors.append('第 %d 行「%s」属于永不记录的信息：删掉这一行的取值' % (i, row[0]))
            elif NEVER_VALUE.search(row[1]):
                errors.append('第 %d 行「%s」的取值像证件号或银行卡号：删掉' % (i, row[0]))
    if start is not None:
        empty = [cells(l)[0] for l in lines[start:end] if is_row(l) and cells(l)[0] != '字段' and len(cells(l)) > 1 and not cells(l)[1]]
        if empty:
            warnings.append('简历基础信息还有空行：' + '、'.join(empty))
    return {'通过': not errors, '错误': errors, '提醒': warnings}


def add(vault, field, value, scope='全部', source='用户原话'):
    vault = Path(vault)
    if fill_plan.NEVER.search(field) or NEVER_VALUE.search(value):
        raise ValueError('「' + field + '」属于永不记录的信息（证件号、银行卡、密码、验证码等）：由用户本人在页面上填，不写进档案')
    if not value.strip():
        raise ValueError('取值为空')
    lines = vault.read_text(encoding='utf-8').splitlines()
    for heading in (BASE, EXTRA):
        start, end = section_bounds(lines, heading)
        if start is not None and any(is_row(l) and cells(l)[0] == field for l in lines[start:end]):
            values = [value, None, None] if heading == BASE else [value, scope, today(), source]
            state, old = set_row(lines, heading, field, values, overwrite=True)
            break
    else:
        if section_bounds(lines, EXTRA)[0] is None:
            at = section_bounds(lines, CHANGES)[0]
            at = len(lines) if at is None else at
            lines[at:at] = [EXTRA, '| 字段 | 取值 | 适用范围 | 记录日期 | 来源 |', '|---|---|---|---|---|', '']
        state, old = set_row(lines, EXTRA, field, [value, scope, today(), source])
    if state == 'updated' and old != value:
        start, end = section_bounds(lines, CHANGES)
        if start is not None:
            last = max([i for i in range(start, end) if lines[i].strip().startswith('|')] or [start])
            lines.insert(last + 1, '| %s | %s | 已更新（旧值不再作为当前值） | %s |' % (today(), field, source))
    vault.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'通过': True, '字段': field, '写入': state}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init'); p.add_argument('--resume', required=True); p.add_argument('--vault', required=True); p.add_argument('--text')
    p = sub.add_parser('check'); p.add_argument('--vault', required=True); p.add_argument('--resume')
    p = sub.add_parser('add'); p.add_argument('--vault', required=True); p.add_argument('--field', required=True)
    p.add_argument('--value', required=True); p.add_argument('--scope', default='全部'); p.add_argument('--source', default='用户原话')
    p = sub.add_parser('has'); p.add_argument('--vault', required=True); p.add_argument('--field', action='append', required=True)
    args = parser.parse_args(argv)
    try:
        if args.cmd == 'init':
            out = init(args.resume, args.vault, args.text)
        elif args.cmd == 'check':
            out = check(args.vault, args.resume)
        elif args.cmd == 'add':
            out = add(args.vault, args.field, args.value, args.scope, args.source)
        else:
            values = fill_plan.vault_values(args.vault)
            out = {'通过': all(values.get(f) for f in args.field), '已有': [f for f in args.field if values.get(f)],
                   '缺少': [f for f in args.field if not values.get(f)]}
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        out = {'通过': False, '错误': [str(exc)]}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get('通过') else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
