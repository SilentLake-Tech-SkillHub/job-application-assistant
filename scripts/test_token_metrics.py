import json
import tempfile
import unittest
from pathlib import Path
from token_metrics import count_messages, load_usage, audit_transcripts
import hashlib


class Metrics(unittest.TestCase):
    def test_text_tokens_are_distinct_from_usage(self):
        r = count_messages([{'role': 'tool', 'content': {'x': '姓名'}}, {'role': 'assistant', 'content': {'x': 'name'}}])
        self.assertEqual(r['total_text_tokens'], r['input_text_tokens'] + r['output_text_tokens'])
        self.assertIsNone(r['billed_usage'])
        self.assertGreater(r['input_text_tokens'], 0)

    def test_usage_requires_explicit_case_provider_and_exact_counts(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'usage.json'
            row = {'case_id': 'case-1', 'provider': 'test', 'model': 'test-model', 'input_tokens': 42, 'output_tokens': 7}
            path.write_text(json.dumps([row]))
            self.assertEqual(load_usage(path)['case-1']['input_tokens'], 42)
            for bad in ({**row, 'input_tokens': -1}, {**row, 'output_tokens': None}, {**row, 'input_tokens': True}):
                path.write_text(json.dumps([bad]))
                with self.assertRaises(ValueError):
                    load_usage(path)
            path.write_text(json.dumps([row, row]))
            with self.assertRaises(ValueError):
                load_usage(path)

    def test_actual_transcript_bytes_and_token_recount(self):
        messages = [{'role': 'tool', 'content': {'field': '姓名'}}]
        raw = (json.dumps(messages, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        case = {'case_id': 'case-1', 'transcript_sha256': hashlib.sha256(raw).hexdigest(), 'tokens': count_messages(messages)}
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d); path = directory / 'case-1.json'; path.write_bytes(raw)
            self.assertEqual(audit_transcripts({'cases': [case]}, directory)['cases'], 1)
            path.write_bytes(raw.replace(b'\n', b'\r\n'))
            with self.assertRaises(ValueError):
                audit_transcripts({'cases': [case]}, directory)


if __name__ == '__main__':
    unittest.main()
