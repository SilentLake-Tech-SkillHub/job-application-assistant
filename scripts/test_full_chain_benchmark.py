"""Offline accounting and controller checks; never starts Codex or spends model quota."""
import json
import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from full_chain_benchmark import normalize_usage, usage_from_events, rollout_usage, tool_time, command_for, truncated_outputs


class AccountingTests(unittest.TestCase):
    def test_permissions_are_scoped_to_owned_mock_server(self):
        args = SimpleNamespace(codex_entry=Path('codex.js'), rea_entry=Path('rea.mjs'), model='synthetic-model')
        cmd = command_for(args, 'baseline', Path('owned root'), Path('docs'), Path('cwd'))
        self.assertIn('mcp_servers.formbench.default_tools_approval_mode="approve"', cmd)
        self.assertIn('read-only', cmd)
        self.assertFalse(any('approval_policy=' in arg or 'dangerously' in arg for arg in cmd))
        self.assertIn('--ignore-user-config', cmd)

    def test_subsets_not_double_counted(self):
        u = normalize_usage({'input_tokens': 100, 'cached_input_tokens': 60, 'output_tokens': 20, 'reasoning_output_tokens': 12})
        self.assertEqual(u['total_tokens'], 120); self.assertEqual(u['uncached_input_tokens'], 40)

    def test_outer_code_mode_truncation_is_detected(self):
        record = {'timestamp': 'synthetic', 'type': 'response_item', 'payload': {
            'type': 'custom_tool_call_output', 'output': [{'type': 'input_text', 'text': 'Script completed'},
                                                        {'type': 'input_text', 'text': 'Warning: truncated output (original token count: 22000)'}]}}
        self.assertEqual(len(truncated_outputs([record])), 1)
        record['payload']['output'] = [{'text': '{"truncated_sections": []}'}]
        self.assertEqual(truncated_outputs([record]), [])

    def test_unknown_reasoning_is_not_zero(self):
        u = usage_from_events([{'type': 'turn.completed', 'usage': {'input_tokens': 100, 'output_tokens': 20}}])
        self.assertIsNone(u['reasoning_output_tokens']); self.assertIsNone(u['cached_input_tokens'])
        with self.assertRaises(ValueError):
            normalize_usage({'input_tokens': 1, 'cached_input_tokens': 2})

    def test_duplicate_and_failed_turn_partial_usage(self):
        event = {'timestamp': 'synthetic', 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
            'total_token_usage': {'input_tokens': 100, 'output_tokens': 20},
            'last_token_usage': {'input_tokens': 100, 'output_tokens': 20}}}}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'rollout.jsonl'; p.write_text('\n'.join(json.dumps(e) for e in [event, event]), encoding='utf-8')
            r = rollout_usage(p)
            self.assertEqual(r['request_count'], 1); self.assertEqual(r['usage']['total_tokens'], 120)
        self.assertIsNone(usage_from_events([{'type': 'turn.failed'}]))

    def test_tool_overlap_union_and_errors(self):
        e = [{'kind': 'tool_completed', 'name': 'x', 'start_wall_ns': a * 10**9,
              'wall_time_ns': b * 10**9, 'seconds': b - a, 'error': error}
             for a, b, error in [(1, 4, False), (3, 5, True), (6, 7, False)]]
        r = tool_time(e); self.assertEqual(r['union_seconds'], 5); self.assertEqual(r['errors'], 1)


def browser_checks():
    from full_chain_mcp import Controller, PROFILE_KEYS
    from form_test_support import map_form
    from fixtures.form_sites import SITES
    # Offline test oracle only; these recipes are never exposed in the real model benchmark.
    recipes = {
        ('search-dropdown', 'bachelor.school'): ([{'css': '#school-widget'}, {'role': 'option', 'name': '合成本科大学'}], {'css': '#school-search'}),
        ('date-cascade', 'bachelor.school'): ([{'css': '#cascade'}, {'css': '#level-one'}, {'css': '#level-two'}], {'css': '#school-readback'}),
        ('date-cascade', 'graduation'): ([{'css': '#graduation'}, {'css': '#date-cell'}], {'css': '#graduation'})}
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for mode in ('baseline', 'enhanced'):
            c = Controller(mode, root / mode, Path(__file__).resolve().parent.parent, Path('not-needed-offline'))
            try:
                with unittest.TestCase().assertRaises(ValueError):
                    c.document('../outside.md')
                sources = {v: k for k, v in PROFILE_KEYS.items()}
                for site in SITES:
                    c.observe(site)
                    mapped = map_form(c.inventories[site], c.pages[site].url)['mapping']
                    fields = []
                    for f in mapped['fields']:
                        semantic = f['semantic']
                        spec = {'index': f['index'], 'source': 'resume' if semantic == 'resume' else sources[f['source'][3:]]}
                        if (site, semantic) in recipes:
                            spec['clicks'], spec['readback'] = recipes[site, semantic]
                        fields.append(spec)
                    fields.sort(key=lambda f: 0 if f['source'] == 'resume' else 1)
                    if mode == 'enhanced':
                        c.auto_fill(site)
                        if site == 'upload-rerender':
                            c.observe(site); c.auto_fill(site)
                        pending = [f for f in fields if 'clicks' in f]
                        if pending:
                            c.configure_fill(site, pending)
                    else:
                        c.configure_fill(site, fields)
                        if site == 'upload-rerender':
                            c.observe(site)
                            # indices remain stable, identities are refreshed by the controller.
                            c.configure_fill(site, [f for f in fields if f['source'] != 'resume'])
                    r = c.review_submit(site)
                    assert r.get('server_verified') and r.get('tracker_verified'), r
                    print('PASS offline controller ' + mode + ' ' + site, flush=True)
                if mode == 'baseline':
                    assert c.finish()['closeout_gate']
                else:
                    with unittest.TestCase().assertRaises(ValueError):
                        c.finish()  # enhanced completion must include real REA, never fake its success
            finally:
                c.close()


if __name__ == '__main__':
    if '--browser' in sys.argv:
        browser_checks()
    else:
        unittest.main()
