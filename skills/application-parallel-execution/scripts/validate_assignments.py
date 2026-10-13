#!/usr/bin/env python3
"""Validate 投递证据/<批次>/并行分工.md (no JSON manifest). Snapshot check only: no locks, no truth checks.

File format (Markdown):

    批次: <批次>
    执行方式: 多个AI            # or 一个AI
    执行渠道: 平台子代理        # or 用户转交
    协调者: <参与者>
    分工版本: 1
    依据: 投递证据/<批次>/确认记录/分工确认.md

    ## 分工
    | 公司 | 招聘主体 | 账号范围 | 负责人 | 输出目录 |
    |---|---|---|---|---|
    | 公司A | 主体A | ATS-A | agent-1 | 投递证据/<批次>/输出/agent-1/公司A |

    ## 交接
    | 公司 | 原负责人 | 新负责人 | 停止证据 | 接收证据 |

Rules: one company / recruiting entity / account scope has exactly one owner; each output folder
sits inside 投递证据/<批次>/输出/<负责人>/; handoffs name both owners and point to existing stop and
acknowledgement records. Role state lives in the Excel tracker and role evidence folders.
"""
import argparse
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[3] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from evidence_layout import parse, value, ref_exists  # noqa: E402
from batch_check import find_root  # noqa: E402

MODES = {'一个AI': 'single', '一个 AI': 'single', '多个AI': 'parallel', '多个 AI': 'parallel'}
CHANNELS = {'平台子代理', '用户转交'}


def table(lines):
    rows, header = [], None
    for line in lines:
        if not line.strip().startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if all(set(c) <= set('-: ') for c in cells):
            continue
        if header is None:
            header = cells
        else:
            rows.append(dict(zip(header, cells)))
    return rows


def validate(path, root=None):
    path = Path(path)
    root = Path(root) if root else find_root(path)
    if root is None:
        return ['找不到投递根目录（投递证据/）']
    if not path.is_file():
        return [str(path) + ' 不存在']
    kv, lines = parse(path)
    errors = []
    batch = value(kv, '批次')
    mode = MODES.get(value(kv, '执行方式'))
    if not batch:
        errors.append('需要「批次:」')
    if not mode:
        errors.append('需要「执行方式: 一个AI / 多个AI」')
    if value(kv, '执行渠道') not in CHANNELS:
        errors.append('需要「执行渠道: 平台子代理 / 用户转交」')
    version = value(kv, '分工版本')
    if not version.isdigit() or int(version) < 1:
        errors.append('需要「分工版本: 正整数」')
    if not ref_exists(root, value(kv, '依据')):
        errors.append('「依据:」必须指向用户确认分工的记录文件')
    rows = table(lines.get('分工', []))
    if not rows:
        errors.append('「## 分工」表为空')
    owners = {r.get('负责人', '') for r in rows if r.get('负责人')}
    coordinator = value(kv, '协调者')
    participants = owners | ({coordinator} if coordinator else set())
    if not coordinator:
        errors.append('需要「协调者:」')
    if mode == 'single' and len(participants) != 1:
        errors.append('一个AI 模式只能有一个参与者')
    if mode == 'parallel' and len(participants) < 2:
        errors.append('多个AI 模式至少两个参与者')
    seen = {'公司': set(), '招聘主体': set(), '账号范围': set()}
    by_company = {}
    for r in rows:
        for key in ('公司', '招聘主体', '账号范围', '负责人', '输出目录'):
            if not r.get(key):
                errors.append('分工行缺少「' + key + '」：' + json.dumps(r, ensure_ascii=False))
        for key in seen:
            if r.get(key):
                if r[key] in seen[key]:
                    errors.append('「' + key + '」' + r[key] + ' 分给了不止一个负责人：同一公司/主体/账号范围只能有一个负责人')
                seen[key].add(r[key])
        expected = ('投递证据/' + batch + '/输出/' + r.get('负责人', '') + '/') if batch else None
        out = r.get('输出目录', '').replace('\\', '/')
        if expected and not (out + '/').startswith(expected):
            errors.append(r.get('公司', '?') + ' 的输出目录必须在 ' + expected + ' 下')
        by_company[r.get('公司')] = r
    for h in table(lines.get('交接', [])):
        company = h.get('公司')
        target = by_company.get(company)
        if target is None:
            errors.append('交接的公司 ' + str(company) + ' 不在分工表里')
            continue
        if h.get('新负责人') != target.get('负责人') or not h.get('原负责人') or h.get('原负责人') == h.get('新负责人'):
            errors.append(company + ' 交接：新负责人必须是当前负责人，且与原负责人不同')
        if h.get('原负责人') not in participants:
            errors.append(company + ' 交接：原负责人不是参与者')
        for key in ('停止证据', '接收证据'):
            if not ref_exists(root, h.get(key, '')):
                errors.append(company + ' 交接需要存在的「' + key + '」文件（旧负责人已停止、新负责人已接收）')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('assignment_md', type=Path)
    parser.add_argument('--root', type=Path)
    args = parser.parse_args()
    errors = validate(args.assignment_md, args.root)
    print(json.dumps({'通过': not errors, '错误': errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
