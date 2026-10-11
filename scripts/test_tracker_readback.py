#!/usr/bin/env python3
"""Review item 4.6: reopen the saved tracker and compare it with the pre-write backup (synthetic workbook)."""
import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook, load_workbook

from tracker_readback import check

HEADER = ['公司', '岗位', '岗位链接', 'JD', '状态']


def build(path):
    wb = Workbook(); ws = wb.active; ws.title = '岗位'
    ws.append(HEADER)
    ws.append(['合成公司A', '产品经理', 'https://example.test/a/1', '合成 JD 1', '待投递'])
    ws.append(['合成公司B', '数据产品', 'https://example.test/b/2', '合成 JD 2', '待投递'])
    ws['G1'] = 'count'; ws['G2'] = '=COUNTA(A2:A3)'
    other = wb.create_sheet('说明'); other['A1'] = '用户自己的备注'
    wb.save(path)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class TrackerReadbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); d = Path(self.tmp.name)
        self.book, self.backup = d / 'tracker.xlsx', d / 'tracker.bak.xlsx'
        build(self.book); shutil.copy(self.book, self.backup); self.pre = sha(self.backup)
        self.expect = [{'key': 'https://example.test/a/1', 'fields': {'状态': '已投递', '公司': '合成公司A'}}]

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, mutate):
        wb = load_workbook(self.book); mutate(wb); wb.save(self.book)

    def run_check(self, expect=None, pre=None):
        return check(self.book, self.backup, pre or self.pre, '岗位', '岗位链接', expect if expect is not None else self.expect)

    def test_correct_single_row_update_passes(self):
        self.write(lambda wb: wb['岗位'].cell(row=2, column=5, value='已投递'))
        self.assertEqual(self.run_check(), [])

    def test_unsaved_write_is_detected(self):
        self.assertTrue(any('byte-identical' in e or 'reads back' in e for e in self.run_check()))

    def test_wrong_value_and_unrelated_row_change(self):
        def mutate(wb):
            wb['岗位'].cell(row=2, column=5, value='待投递?')
            wb['岗位'].cell(row=3, column=5, value='已投递')
        self.write(mutate)
        errors = self.run_check()
        self.assertTrue(any('reads back' in e for e in errors))
        self.assertTrue(any('unrelated row changed' in e for e in errors))

    def test_other_sheet_formula_and_hash_protection(self):
        def mutate(wb):
            wb['岗位'].cell(row=2, column=5, value='已投递')
            wb['岗位']['G2'] = 5
            wb['说明']['A1'] = '被覆盖'
        self.write(mutate)
        errors = self.run_check()
        self.assertTrue(any('formula changed' in e for e in errors))
        self.assertTrue(any('other sheet changed' in e for e in errors))
        self.assertTrue(any('backup SHA-256' in e for e in self.run_check(pre='0' * 64)))

    def test_duplicate_row_and_unexpected_row(self):
        def mutate(wb):
            wb['岗位'].cell(row=2, column=5, value='已投递')
            wb['岗位'].append(['合成公司A', '产品经理', 'https://example.test/a/1', '合成 JD 1', '已投递'])
            wb['岗位'].append(['合成公司C', '新岗位', 'https://example.test/c/3', '合成 JD 3', '待投递'])
        self.write(mutate)
        errors = self.run_check()
        self.assertTrue(any('expected exactly one row' in e for e in errors))
        self.assertTrue(any('unexpected new row' in e for e in errors))

    def test_error_values_and_missing_backup(self):
        self.write(lambda wb: (wb['岗位'].cell(row=2, column=5, value='已投递'), wb['说明'].__setitem__('B1', '#REF!')))
        self.assertTrue(any('#REF!' in e for e in self.run_check()))
        self.backup.unlink()
        self.assertEqual(self.run_check(), ['backup not found: make a recoverable backup before writing'])


if __name__ == '__main__':
    unittest.main()
