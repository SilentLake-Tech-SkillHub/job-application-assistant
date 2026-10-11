#!/usr/bin/env python3
"""Stress and robustness: large ledgers stay fast and malformed input never crashes the tools.

Thresholds are generous ceilings for a laptop or CI runner, not performance promises.
STRESS_SCALE (default 1) multiplies the batch size.
"""
import copy
import json
import os
import random
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from openpyxl import Workbook, load_workbook

from validate_batch import validate
from stage_gate import run as gate
from ledger_checks import closeout_status
from tracker_readback import check as tracker_check
from test_validate_batch import fixture, make_submit_ready, H
from test_ledger_checks import prepared

SCALE = max(1, int(os.environ.get('STRESS_SCALE', '1')))
COMPANIES, ROLES_PER_COMPANY = 400 * SCALE, 5


def big_batch():
    data = fixture()
    template_company = data['companies'][0]
    template_role = data['roles'][0]
    data['batch']['quotas'] = {'large': COMPANIES}
    data['companies'], data['roles'] = [], []
    stages = ['verified', 'prepared', 'reviewed', 'submitted', 'submitted']
    for c in range(COMPANIES):
        company = copy.deepcopy(template_company)
        company.update(company_key='co%d' % c, bucket='large')
        company['count_rule']['max_applications'] = ROLES_PER_COMPANY
        data['companies'].append(company)
        for j in range(ROLES_PER_COMPANY):
            r = copy.deepcopy(template_role)
            job = '%d-%d' % (c, j)
            r.update(company_key='co%d' % c, official_job_id=job, role_key='co%d:id:%s' % (c, job),
                     direct_url='https://example.test/co%d/%s' % (c, job))
            stage = stages[j]
            if stage != 'verified':
                prepared(r)
            if stage in ('reviewed', 'submitted'):
                r['stage'] = 'reviewed'
                make_submit_ready(r)
                r['stage'] = stage
            if stage == 'submitted':
                r['receipt_ref'] = 'synthetic-receipt-' + job
                r['execution']['submit'] = {'status': 'complete', 'evidence_ref': r['receipt_ref']}
            data['roles'].append(r)
    return data


def mutate(node, rng, depth=0):
    """Randomly delete keys, change types or replace values somewhere in the structure."""
    junk = [None, 0, -1, '', 'x', [], {}, True, 1.5, ['x'], {'x': None}]
    if isinstance(node, dict) and node:
        key = rng.choice(list(node))
        action = rng.random()
        if action < 0.3:
            del node[key]
        elif action < 0.6 or depth > 4:
            node[key] = rng.choice(junk)
        else:
            mutate(node[key], rng, depth + 1)
    elif isinstance(node, list) and node:
        i = rng.randrange(len(node))
        if rng.random() < 0.5:
            node[i] = rng.choice(junk)
        else:
            mutate(node[i], rng, depth + 1)


class StressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = big_batch()

    def test_large_ledger_validates_quickly(self):
        start = time.perf_counter()
        errors, report = validate(self.data)
        elapsed = time.perf_counter() - start
        self.assertEqual(errors, [])
        self.assertEqual(report['verified_submissions'], COMPANIES * 2)
        self.assertEqual(report['prepared_applications'], COMPANIES * 4)
        self.assertLess(elapsed, 20 * SCALE, 'validate took %.2fs for %d roles' % (elapsed, len(self.data['roles'])))
        print('\n[stress] validate %d companies / %d roles: %.2fs' % (COMPANIES, len(self.data['roles']), elapsed))

    def test_gate_and_closeout_on_large_ledger(self):
        start = time.perf_counter()
        result = gate(self.data, 'prepare', 'co0:id:0-0')
        self.assertTrue(result['allowed'], result['errors'][:3])
        _, report = validate(self.data)
        status = closeout_status(self.data, report)
        self.assertFalse(status['can_close'])
        self.assertEqual(sum('is verified' in r for r in status['reasons']), COMPANIES)
        self.assertLess(time.perf_counter() - start, 40 * SCALE)

    def test_fuzzed_ledgers_never_crash(self):
        rng = random.Random(20261012)
        base = fixture()
        r = prepared(base['roles'][0]); r['stage'] = 'reviewed'; make_submit_ready(r)
        for i in range(3000):
            data = copy.deepcopy(base)
            for _ in range(rng.randint(1, 4)):
                mutate(data, rng)
            try:
                errors, report = validate(data)
                closeout_status(data, report)
                gate(data, rng.choice(['query', 'prepare', 'review', 'submit', 'closeout']), 'alpha:id:1')
            except Exception as exc:  # noqa: BLE001 - any crash is a failure
                self.fail('iteration %d crashed: %r\n%s' % (i, exc, json.dumps(data, ensure_ascii=False)[:800]))

    def test_large_tracker_readback(self):
        with tempfile.TemporaryDirectory() as tmp:
            book, backup = Path(tmp, 't.xlsx'), Path(tmp, 't.bak.xlsx')
            wb = Workbook(); ws = wb.active; ws.title = '岗位'
            ws.append(['公司', '岗位链接', '状态'])
            rows = 5000 * SCALE
            for i in range(rows):
                ws.append(['co%d' % i, 'https://example.test/%d' % i, '待投递'])
            wb.save(book); shutil.copy(book, backup)
            import hashlib
            pre = hashlib.sha256(backup.read_bytes()).hexdigest()
            wb = load_workbook(book); wb['岗位'].cell(row=rows + 1, column=3, value='已投递'); wb.save(book)
            start = time.perf_counter()
            errors = tracker_check(book, backup, pre, '岗位', '岗位链接',
                                   [{'key': 'https://example.test/%d' % (rows - 1), 'fields': {'状态': '已投递'}}])
            self.assertEqual(errors, [])
            self.assertLess(time.perf_counter() - start, 60 * SCALE)


if __name__ == '__main__':
    unittest.main()
