"""Static complete-package check; does not register skills or access a real ATS.

All files are read as UTF-8 explicitly so the check behaves the same on Windows (GBK/cp936 locale).
"""
import ast
import os
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
skills = list(root.rglob('SKILL.md'))
assert skills, 'no skill entrypoints'
for p in skills:
    source = p.read_text(encoding='utf-8')
    assert source.startswith('---\n') and source.count('\n---\n') >= 1, p
    header = source.split('\n---\n', 1)[0]
    assert re.search(r'^name: [a-z0-9-]+$', header, re.M), p
    assert re.search(r'^description: .+', header, re.M), p
def slug(heading):
    # GitHub heading anchors: lowercase, drop punctuation (keep word chars, CJK, spaces, hyphens), spaces -> hyphens.
    text = re.sub(r'[`*_]', '', heading.strip().lower())
    text = re.sub(r'[^\w\- ]', '', text)
    return text.replace(' ', '-')


def anchors(path):
    found, seen = set(), {}
    in_code = False
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('```'):
            in_code = not in_code
        if in_code:
            continue
        m = re.match(r'^#{1,6} (.+)$', line)
        if m:
            base = slug(m.group(1)); n = seen.get(base, 0); seen[base] = n + 1
            found.add(base if n == 0 else base + '-' + str(n))
    return found


links = anchored = 0
for p in root.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)', p.read_text(encoding='utf-8')):
        if target.startswith(('https:', 'http:', '<')):
            continue
        file_part, _, anchor = target.partition('#')
        dest = (p.parent/file_part) if file_part else p
        assert dest.exists(), (p, target)
        if anchor and dest.suffix == '.md':
            assert anchor in anchors(dest), ('broken anchor', p, target)
            anchored += 1
        links += 1
scripts = list(root.rglob('*.py'))
for p in scripts:
    ast.parse(p.read_text(encoding='utf-8'), filename=str(p))
validators = [p for p in scripts if p.name in {'batch_check.py', 'stage_gate.py', 'tracker_readback.py', 'validate_assignments.py',
                                                'fill_plan.py', 'playwright_fill.py', 'profile_vault.py'}]
with tempfile.TemporaryDirectory() as temp:
    for p in validators:  # each CLI loads from another cwd and answers --help
        result = subprocess.run([sys.executable, str(p), '--help'], cwd=temp, capture_output=True, text=True,
                                encoding='utf-8', env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        assert result.returncode == 0 and not result.stderr, (p, result.stdout, result.stderr)
assert not list(root.rglob('*.json')) or all('reports/' in p.as_posix() for p in root.rglob('*.json')), 'no JSON ledgers in the package'
print(json.dumps({'passed': True, 'skill_entrypoints': len(skills), 'local_links': links, 'anchors_checked': anchored,
                  'python_sources': len(scripts), 'validators_loaded': len(validators),
                  'scope': 'complete copied package; static metadata/references and CLI loading, no platform registration or live ATS'}, ensure_ascii=False))
