"""Count replay transcript text; optionally ingest independent provider usage.

Tokenized transcript counts exclude model hidden reasoning, system/skill context, cache billing,
tool envelopes, and repeated conversation history. They must never be called billed LLM usage.
"""
import json
import hashlib
import re
import tiktoken


def count_messages(messages, encoding='o200k_base'):
    tokenizer = tiktoken.get_encoding(encoding)
    result = {'input_text_tokens': 0, 'output_text_tokens': 0, 'encoding': encoding,
              'measurement': 'tokenized_replay_text', 'billed_usage': None}
    for message in messages:
        payload = json.dumps(message['content'], ensure_ascii=False, separators=(',', ':'))
        key = 'output_text_tokens' if message['role'] == 'assistant' else 'input_text_tokens'
        result[key] += len(tokenizer.encode(payload, disallowed_special=()))
    result['total_text_tokens'] = result['input_text_tokens'] + result['output_text_tokens']
    result['exchange_count'] = len(messages)
    return result


def load_usage(path):
    """Rows: case_id, provider, model, input_tokens, output_tokens; no invented defaults."""
    rows = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(rows, list):
        raise ValueError('Usage must be an array of provider usage rows')
    result = {}
    for row in rows:
        required = ('case_id', 'provider', 'model', 'input_tokens', 'output_tokens')
        if not isinstance(row, dict) or any(k not in row for k in required):
            raise ValueError('Usage row is missing provider/model/case/token evidence')
        if any(type(row[k]) is not int or row[k] < 0 for k in ('input_tokens', 'output_tokens')):
            raise ValueError('Provider usage tokens must be nonnegative integers')
        if not all(isinstance(row[k], str) and row[k] for k in ('case_id', 'provider', 'model')):
            raise ValueError('Provider/model/case_id must be nonempty strings')
        if row['case_id'] in result:
            raise ValueError('Duplicate usage case')
        result[row['case_id']] = row
    return result


def audit_transcripts(report, directory):
    """Verify bytes on disk and independently recount payload tokens for every measured case."""
    seen = set()
    for case in report['cases']:
        ident = case['case_id']
        if not isinstance(ident, str) or not re.fullmatch(r'[a-z0-9-]+', ident) or ident in seen:
            raise ValueError('Invalid or duplicate transcript case identity')
        seen.add(ident)
        raw = (directory / (ident + '.json')).read_bytes()
        if hashlib.sha256(raw).hexdigest() != case['transcript_sha256']:
            raise ValueError('Transcript byte digest mismatch: ' + ident)
        counted = count_messages(json.loads(raw), case['tokens']['encoding'])
        for metric in ('input_text_tokens', 'output_text_tokens', 'total_text_tokens', 'exchange_count'):
            if counted[metric] != case['tokens'][metric]:
                raise ValueError('Transcript token recount mismatch: ' + ident)
    return {'cases': len(seen), 'byte_hashes_verified': True, 'token_recounts_verified': True}
