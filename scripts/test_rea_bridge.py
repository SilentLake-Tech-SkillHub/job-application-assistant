#!/usr/bin/env python3
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from rea_bridge import endpoint, origin, project, inspect


def evidence():
    return {'evidence_id': 'mock-evidence', 'operation': 'inspect_web_page', 'confidence': 'observed',
            'limitations': ['Attach window excludes earlier network activity.'], 'normalized_result': {
                'target': {'target_id': 'target-1', 'origin': 'https://mock.example.test'},
                'completeness': {'status': 'attach_limited', 'truncated_sections': [], 'unavailable_sections': []},
                'scripts': {'items': [{}, {}]}, 'resources': [{}], 'network': {'requests': []}}}


class Bridge(unittest.TestCase):
    def test_endpoint_scope(self):
        self.assertEqual(endpoint('http://127.0.0.1:9222/'), 'http://127.0.0.1:9222')
        self.assertEqual(endpoint('http://[::1]:9222'), 'http://[::1]:9222')
        for u in ('http://localhost:9222', 'http://192.168.1.1:9222', 'http://user:pass@127.0.0.1:9222',
                  'http://127.0.0.1:9222/?token=x', 'http://127.0.0.1', 'https://127.0.0.1:9222'):
            with self.subTest(u=u), self.assertRaises(ValueError):
                endpoint(u)
        for u in ('https://mock.example.test/path', 'https://*.example.test', 'file:///tmp/a'):
            with self.assertRaises(ValueError):
                origin(u)

    def test_explicit_omission_and_target_identity(self):
        compact = project(evidence(), 'https://mock.example.test', 'target-1')
        self.assertEqual(compact['counts']['scripts'], 2)
        with self.assertRaises(ValueError):
            project(evidence(), 'https://other.example.test', 'target-1')
        for condition in ('truncated', 'missing'):
            e = evidence()
            e['normalized_result']['completeness'] = {'status': 'truncated'} if condition == 'truncated' else {}
            with self.assertRaises(ValueError):
                project(e, 'https://mock.example.test', 'target-1')

    def test_actual_subprocess_adapter_and_preserved_raw_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            fake = Path(d) / 'fake_rea.py'
            fake.write_text('import json,sys\nassert sys.argv[1:4] == ["inspect-web-page","http://127.0.0.1:9222","target-1"]\nprint(' + repr(json.dumps(evidence())) + ')', encoding='utf-8')
            out = Path(d) / 'evidence.json'
            compact = inspect([sys.executable, str(fake)], 'http://127.0.0.1:9222', 'target-1', 'https://mock.example.test', out)
            self.assertEqual(json.loads(out.read_text()), evidence())
            self.assertEqual(len(compact['artifact_sha256']), 64)
            self.assertNotIn('result', compact)

    def test_missing_cli_is_explicit(self):
        with self.assertRaises(OSError):
            inspect(['definitely-unavailable-rea-command'], 'http://127.0.0.1:9222', 'target-1', 'https://mock.example.test', 'unused.json')


if __name__ == '__main__':
    unittest.main()
