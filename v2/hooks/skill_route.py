#!/usr/bin/env python3
"""Per-turn call order generated from the SKILL.md stage table (single source, task C38).

The Hook injects only the stage name and its tools; entry conditions, deliverables,
completion criteria and exception routes are read from SKILL.md itself.
"""
import hashlib
from pathlib import Path
import sys

SKILL = Path(__file__).resolve().parents[1] / 'SKILL.md'
START, END = '<!-- 环节表:开始 -->', '<!-- 环节表:结束 -->'
HEADER = ('投递组件调用顺序（由投递组件 SKILL.md 环节表生成）。每个环节的进入条件、组件返回、'
          '交给用户的结果、完成标准和异常去向，按 SKILL.md 执行：\n')


def route_text(skill=SKILL):
    text = Path(skill).read_text(encoding='utf-8')
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError('WORKFLOW_ROUTE_SECTION_MISSING')
    body = text.split(START, 1)[1].split(END, 1)[0]
    rows = []
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) < 3 or not cells[0] or set(cells[0]) <= set('-: ') or cells[0] == '环节':
            continue
        rows.append(f'{len(rows) + 1}. {cells[0]}：{cells[2]}')
    if not rows:
        raise ValueError('WORKFLOW_ROUTE_SECTION_MISSING')
    return HEADER + '\n'.join(rows) + '\n'


def route_sha256(skill=SKILL):
    return hashlib.sha256(route_text(skill).encode('utf-8')).hexdigest()


if __name__ == '__main__':
    # `python3 hooks/skill_route.py` prints the text; `--sha256` prints the value for the host lock file.
    print(route_sha256() if '--sha256' in sys.argv[1:] else route_text(), end='' if '--sha256' not in sys.argv[1:] else '\n')
