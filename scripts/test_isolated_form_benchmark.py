"""Offline grid/scope tests; no model quota. --browser checks real owned fixtures."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from isolated_form_benchmark import cells, prompt
from full_chain_progress import receipt_progress, timestamp_ns
from fixtures.form_sites import SITES

HERE = Path(__file__).resolve().parent


class IsolatedTests(unittest.TestCase):
    def test_document_delivery_requires_full_body_in_actual_output(self):
        from audit_isolated_form import delivered_documents
        paths = ['SKILL.md', 'references/stage-contract.md', 'references/browser-application.md',
                 'skills/application-content-fill/SKILL.md', 'skills/privacy-info-fill/SKILL.md']
        events = [{'kind': 'tool_completed', 'name': 'read_document', 'result': {'path': p, 'text': 'body:' + p}} for p in paths]
        output = {'type': 'response_item', 'payload': {'type': 'custom_tool_call_output',
                   'output': [{'text': json.dumps({'content': [{'text': json.dumps([e['result'] for e in events])}]})}]}}
        self.assertEqual(len(delivered_documents(events, [output])), 5)
        output['payload']['output'] = [{'text': json.dumps(paths)}]
        with self.assertRaises(AssertionError): delivered_documents(events, [output])

    def test_missing_provider_usage_is_not_rendered_as_zero(self):
        from render_isolated_form import render
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            report = {'results': [{'case_id': 'synthetic-failed', 'site': SITES[0], 'cache_state': 'cold',
                      'mode': 'baseline', 'model': 'synthetic', 'completed': False, 'wall_seconds': 1.,
                      'usage': None, 'verified_batch': None, 'request_count': None, 'rea_cli_seconds': 0,
                      'tool_timing': {'errors': 0}}]}
            (folder / 'results.json').write_text(json.dumps(report), encoding='utf-8')
            render(folder)
            page = (folder / 'dashboard.html').read_text(encoding='utf-8')
            self.assertIn('未返回 token', page)
            self.assertIn('待测', page)
            self.assertIsNone(json.loads((folder / 'summary.json').read_bytes())['totals']['known_total_tokens'])
            self.assertFalse((folder / 'comparison.png').exists())

    def test_complete_unique_balanced_grid(self):
        grid = cells()
        self.assertEqual(len(grid), 20)
        self.assertEqual(len({r['case_id'] for r in grid}), 20)
        self.assertEqual({(r['site'], r['cache_state'], r['mode']) for r in grid},
                         {(s, c, m) for s in SITES for c in ('cold', 'warm') for m in ('baseline', 'optimized')})
        self.assertEqual(sum(r['mode'] == 'baseline' for r in grid[::2]), 5)

    def test_prompt_scopes_one_site_and_preserves_real_gates(self):
        for row in cells():
            text = prompt(row['mode'], row['site'], row['cache_state'])
            self.assertIn('"max_output_tokens": 50000', text)
            self.assertIn(row['site'], text)
            self.assertFalse(any(s in text for s in SITES if s != row['site']))
            self.assertIn('Submit gate', text)
            self.assertIn('Excel tracker readback', text)
            self.assertIn('fresh model context', text)
            self.assertNotIn('five', text)

    def test_single_receipt_requires_exact_scope(self):
        start = '2026-01-01T00:00:00+00:00'
        run = {'started_utc': start, 'wall_seconds': 10, 'request_usage': []}
        event = {'kind': 'verified_receipt', 'site': 'native-bilingual', 'receipt': 'synthetic',
                 'wall_time_ns': timestamp_ns(start) + 10**9}
        self.assertEqual(len(receipt_progress(run, [event], ['native-bilingual'])), 1)
        with self.assertRaises(ValueError): receipt_progress(run, [event], ['date-cascade'])


def browser_checks():
    cases = [('baseline', 'native-bilingual', 'cold'), ('baseline', 'native-bilingual', 'warm'),
             ('optimized', 'native-bilingual', 'cold'), ('optimized', 'native-bilingual', 'warm'),
             ('optimized', 'upload-rerender', 'warm'), ('optimized', 'date-cascade', 'warm')]
    with tempfile.TemporaryDirectory() as d:
        for i, (mode, site, state) in enumerate(cases):
            result = subprocess.run([sys.executable, str(HERE / 'isolated_form_mcp.py'), '--runtime', str(HERE.parent),
                                     '--mode', mode, '--site', site, '--cache-state', state, '--root', str(Path(d) / str(i)),
                                     '--docs', str(HERE.parent), '--rea-entry', 'not-needed-offline', '--self-test'],
                                    capture_output=True, text=True, encoding='utf-8')
            assert result.returncode == 0, result.stdout + result.stderr
            print('PASS isolated offline ' + mode + '/' + site + '/' + state, flush=True)


if __name__ == '__main__':
    if '--browser' in sys.argv:
        browser_checks()
    else:
        unittest.main()
