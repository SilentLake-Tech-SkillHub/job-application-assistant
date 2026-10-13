#!/usr/bin/env python3
"""Optional real installed REA passive capture against an owned mock browser, never a user profile.

Requires an already installed rea-agents entrypoint, Python Playwright and Chromium.
The normal CI tests do not acquire or install the optional REA runtime.
"""
import argparse
import json
import socket
import sys
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from fixtures.form_sites import serve
from form_test_support import chrome_path
from rea_bridge import inspect


def verify(entry, out):
    out.mkdir(parents=True, exist_ok=True)
    entry = entry.resolve()
    if not entry.is_file():
        raise ValueError('Supply an installed REA .mjs entrypoint')
    server, _, base = serve()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    endpoint = f'http://127.0.0.1:{port}'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path=chrome_path(), args=[f'--remote-debugging-port={port}'])
            try:
                page = browser.new_page(); page.goto(base + '/forms/search-dropdown')
                page.wait_for_selector('#school-widget')
                with urllib.request.urlopen(endpoint + '/json/list', timeout=5) as response:
                    targets = json.load(response)
                selected = [t for t in targets if t.get('type') == 'page' and t.get('url') == base + '/forms/search-dropdown']
                if len(selected) != 1:
                    raise ValueError('Owned mock target was not unique')
                compact = inspect(['node', str(entry)], endpoint, selected[0]['id'], base, out / 'real-rea-evidence.json')
                if page.url != base + '/forms/search-dropdown' or not page.locator('#school-widget').is_visible():
                    raise ValueError('Passive capture did not preserve the owned page')
                compact['page_preserved'] = True
                compact['fixture'] = 'search-dropdown'
                compact['measurement'] = 'real REA CLI passive capture; not included in latency/token benchmark'
                (out / 'real-rea-verification.json').write_text(json.dumps(compact, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(compact, ensure_ascii=False))
                return compact
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rea-entry', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('test-results/rea-real'))
    args = parser.parse_args()
    try:
        verify(args.rea_entry, args.out)
    except Exception as e:
        print(type(e).__name__ + ': ' + str(e), file=sys.stderr)
        sys.exit(1)
