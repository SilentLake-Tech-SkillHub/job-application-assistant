#!/usr/bin/env python3
"""Install the submit guard hook for Claude Code, Codex or Kimi Code.

  python hooks/install_hooks.py --platform claude-code --project <投递根目录>          # show what would change
  python hooks/install_hooks.py --platform claude-code --project <投递根目录> --write  # apply

Platforms and files:
  claude-code  <project>/.claude/settings.json       (also GLM/Z.ai models run inside Claude Code)
  codex        <project>/.codex/config.toml          (trust it once with /hooks; project layer must be trusted)
  kimi         ~/.kimi-code/config.toml              (Kimi Code reads hooks from the user config)

The command uses this Python interpreter and the guard's absolute path, so it works on Windows,
macOS and Linux without relying on python/python3 being on PATH. Re-running is idempotent.
"""
import argparse
import json
import sys
from pathlib import Path

GUARD = Path(__file__).resolve().parent / 'application_guard.py'
MARK = 'job-application-assistant submit guard'


def command():
    return '"' + sys.executable + '" "' + str(GUARD) + '"'


def toml_literal(text):
    if "'" in text:
        return json.dumps(text, ensure_ascii=False)  # basic string with escapes
    return "'" + text + "'"


def claude_code(project):
    path = Path(project) / '.claude' / 'settings.json'
    data = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
    groups = data.setdefault('hooks', {}).setdefault('PreToolUse', [])
    entry = {'matcher': 'mcp__.*', 'hooks': [{'type': 'command', 'command': command(), 'timeout': 30}]}
    groups[:] = [g for g in groups if not any(str(GUARD.name) in str(h.get('command', '')) for h in g.get('hooks', []))]
    groups.append(entry)
    return path, json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def toml_append(path, block):
    text = path.read_text(encoding='utf-8') if path.is_file() else ''
    if MARK in text:
        start = text.index('# >>> ' + MARK)
        end = text.index('# <<< ' + MARK) + len('# <<< ' + MARK)
        text = text[:start].rstrip('\n') + ('\n\n' if text[:start].strip() else '') + text[end:].lstrip('\n')
    sep = '\n\n' if text.strip() else ''
    return path, text.rstrip('\n') + sep + '# >>> ' + MARK + '\n' + block + '# <<< ' + MARK + '\n'


def codex(project):
    block = ('[[hooks.PreToolUse]]\nmatcher = "mcp__.*"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\n'
             'command = ' + toml_literal(command()) + '\ntimeout = 30\n')
    return toml_append(Path(project) / '.codex' / 'config.toml', block)


def kimi(_project):
    block = ('[[hooks]]\nevent = "PreToolUse"\ncommand = ' + toml_literal(command()) + '\ntimeout = 30\n')
    return toml_append(Path.home() / '.kimi-code' / 'config.toml', block)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--platform', required=True, choices=['claude-code', 'codex', 'kimi'])
    parser.add_argument('--project', default='.', help='application root (folder that holds 投递证据/)')
    parser.add_argument('--write', action='store_true', help='apply the change; without it, print it only')
    args = parser.parse_args()
    if not (Path(args.project) / '投递证据').is_dir():
        print('提示：' + str(Path(args.project).resolve()) + ' 下还没有 投递证据/ 文件夹；守卫只在含该文件夹的目录里生效。', file=sys.stderr)
    path, content = {'claude-code': claude_code, 'codex': codex, 'kimi': kimi}[args.platform](args.project)
    if not args.write:
        print('# would write ' + str(path) + '\n' + content)
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    print('wrote ' + str(path))
    if args.platform == 'codex':
        print('Codex: 打开项目后在 /hooks 中信任该钩子；项目层未受信任时不会加载。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
