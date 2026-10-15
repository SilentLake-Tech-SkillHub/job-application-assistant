#!/usr/bin/env python3
"""Bounded optional REA diagnostics. Attach to one explicitly selected loopback target.

Use --command-json '["node","/path/to/rea.mjs"]' or '["rea"]'; no shell parsing.
Raw Evidence stays in a private output file; stdout contains only bounded diagnostic counts.
This bridge never launches a browser, invokes a scenario, fills fields or submits an application.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from urllib.parse import urlsplit
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024


def script_excerpts(artifacts, terms=(), budget=2400):
    """Bound model-visible source while retaining complete raw Evidence on disk.

Line/character coordinates and omissions are explicit; a snippet is never claimed to be a complete
capture. Selectors come from the actual DOM, not a site-specific recipe.
"""
    if not 128 <= budget <= 16000:
        raise ValueError('Invalid excerpt character budget')
    result = []
    remaining = budget
    for artifact in artifacts:
        lines = artifact.get('text', '').splitlines()
        if not lines or remaining <= 0:
            continue
        selected = set()
        needles = [str(t).lstrip('#.') for t in terms if len(str(t).lstrip('#.')) > 2]
        for i, line in enumerate(lines):
            if any(t in line for t in needles):
                selected.update(range(max(0, i - 1), min(len(lines), i + 2)))
        if not selected:
            selected.update(range(min(len(lines), 8)))
        snippets = []
        for i in sorted(selected):
            if remaining <= 0:
                break
            text = lines[i][:remaining]
            snippets.append({'line': i + 1, 'start_character': 0, 'text': text,
                             'partial_line': len(text) < len(lines[i])})
            remaining -= len(text)
        result.append({'sha256': artifact['sha256'], 'total_lines': len(lines), 'snippets': snippets,
                       'omitted': len(snippets) != len(lines) or any(s['partial_line'] for s in snippets)})
    return result


def endpoint(value):
    u = urlsplit(value)
    if (u.scheme != 'http' or u.hostname not in ('127.0.0.1', '::1') or not u.port or
            u.username or u.password or u.path not in ('', '/') or u.query or u.fragment):
        raise ValueError('REA endpoint must be an explicit-port literal loopback HTTP URL')
    return value.rstrip('/')


def origin(value):
    u = urlsplit(value)
    if (u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or
            u.query or u.fragment or u.path not in ('', '/') or '*' in u.hostname):
        raise ValueError('Select an exact credential-free HTTP(S) origin')
    return value.rstrip('/')


def project(evidence, allowed_origin, target):
    # REA createEvidence flattens EvidenceObservation into the public Evidence envelope.
    obs = evidence
    if obs.get('operation') != 'inspect_web_page' or obs.get('confidence') != 'observed':
        raise ValueError('Expected observed inspect_web_page Evidence')
    result = obs.get('normalized_result', {})
    selected = result.get('target', {})
    if selected.get('target_id') != target or selected.get('origin') != allowed_origin:
        raise ValueError('REA returned a different target/origin')
    completeness = result.get('completeness', {})
    if not completeness or completeness.get('status') == 'truncated' or completeness.get('truncated_sections'):
        raise ValueError('Missing/truncated REA evidence cannot validate a mapping')
    return {'provider': 'REA', 'operation': obs['operation'], 'evidence_id': evidence.get('evidence_id'),
            'target_id': target, 'origin': allowed_origin, 'completeness': completeness,
            'counts': {'scripts': len(result.get('scripts', {}).get('items', [])),
                       'resources': len(result.get('resources', [])),
                       'network_requests': len(result.get('network', {}).get('requests', []))},
            'limitations': obs.get('limitations', []),
            'authority': 'diagnostic observation only; no locator, semantic or submission proof'}


def inspect(command, cdp, target, allowed_origin, out, observation_ms=500, include_script_sources=False):
    cdp, allowed_origin = endpoint(cdp), origin(allowed_origin)
    if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
        raise ValueError('command-json must be a nonempty argv array')
    if not target or len(target) > 256 or not 0 <= observation_ms <= 10000:
        raise ValueError('Invalid target or observation duration')
    # Capture in temporary files so stdout/stderr buffering has a fixed retained budget.
    import tempfile
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        started = time.perf_counter()
        result = subprocess.run([*command, 'inspect-web-page', cdp, target, '--allowed-origins', allowed_origin,
                                 '--observation-ms', str(observation_ms), *(['--include-script-sources'] if include_script_sources else []), '--json'],
                                stdout=stdout, stderr=stderr, timeout=30, shell=False)
        cli_seconds = time.perf_counter() - started
        if result.returncode:
            raise ValueError('REA CLI failed; no evidence accepted (exit %s)' % result.returncode)
        if stdout.tell() > MAX_BYTES:
            raise ValueError('REA Evidence exceeds retained budget')
        stdout.seek(0); raw = stdout.read()
    post_started = time.perf_counter()
    evidence = json.loads(raw)
    compact = project(evidence, allowed_origin, target)
    Path(out).write_bytes(raw)
    compact['artifact_sha256'] = hashlib.sha256(raw).hexdigest()
    compact['timing'] = {'cli_process_seconds': cli_seconds,
                         'parse_validate_write_seconds': time.perf_counter() - post_started,
                         'boundary': 'CLI includes process startup, CDP attach and capture; those internal phases are not independently timed'}
    return compact


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--command-json', default='["rea"]')
    p.add_argument('--cdp', required=True); p.add_argument('--target', required=True)
    p.add_argument('--origin', required=True); p.add_argument('--out', required=True)
    p.add_argument('--observation-ms', type=int, default=500)
    p.add_argument('--include-script-sources', action='store_true', help='Explicitly retain selected-origin script sources for private diagnosis')
    args = p.parse_args()
    try:
        print(json.dumps(inspect(json.loads(args.command_json), args.cdp, args.target, args.origin,
                                 args.out, args.observation_ms, args.include_script_sources), ensure_ascii=False))
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as e:
        # Do not echo raw CLI output or credentials.
        print('REA diagnostic unavailable: ' + type(e).__name__, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
