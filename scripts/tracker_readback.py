#!/usr/bin/env python3
"""Read back a saved role tracker after a write (workbook contract).

Reopens the saved .xlsx and compares it with the pre-write backup:
  * the backup is the file that was read before writing (its SHA-256 matches --pre-sha256);
  * every expected row exists exactly once by key and shows the expected values;
  * rows that were not meant to change, other sheets, formulas and sheet order are unchanged;
  * no cell shows an Excel error value.
Structural readback only; it does not prove a website accepted an application.

  tracker_readback.py --workbook T.xlsx --backup T.bak.xlsx --pre-sha256 <hex> \
      --sheet <name> --key-column <header> --expect expected.json

expected.json: [{"key": "<direct url>", "fields": {"<header>": "<value>", ...}}, ...]
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

try:
    from openpyxl import load_workbook
except ImportError:  # pragma: no cover - reported as a readable failure
    load_workbook = None

ERROR_VALUES = {'#REF!', '#VALUE!', '#NAME?', '#DIV/0!', '#N/A', '#NUM!', '#NULL!'}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def table(ws, key_column):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return None, {}, ['sheet ' + ws.title + ' is empty']
    header = [str(h).strip() if h is not None else '' for h in rows[0]]
    if key_column not in header:
        return header, {}, ['key column ' + repr(key_column) + ' not in header of ' + ws.title]
    k = header.index(key_column)
    by_key, errors = {}, []
    for number, row in enumerate(rows[1:], start=2):
        key = row[k] if k < len(row) else None
        if key in (None, ''):
            continue
        by_key.setdefault(str(key).strip(), []).append((number, dict(zip(header, row))))
    return header, by_key, errors


def sheet_values(ws):
    return [[c for c in row] for row in ws.iter_rows(values_only=True)]


def check(workbook, backup, pre_sha256, sheet, key_column, expected):
    errors = []
    if load_workbook is None:
        return ['openpyxl is required: pip install openpyxl']
    if not Path(workbook).is_file():
        return ['workbook not found']
    if not Path(backup).is_file():
        return ['backup not found: make a recoverable backup before writing']
    if sha256(backup) != pre_sha256.lower():
        errors.append('backup SHA-256 differs from the hash recorded before writing')
    if sha256(workbook) == sha256(backup) and expected:
        errors.append('workbook is byte-identical to the backup: the write was not saved')
    after_f, before_f = load_workbook(workbook), load_workbook(backup)
    after_v = load_workbook(workbook, data_only=True)
    if after_f.sheetnames != before_f.sheetnames:
        errors.append('sheet list or order changed')
    if sheet not in after_f.sheetnames:
        return errors + ['sheet ' + repr(sheet) + ' not found']
    for name in after_f.sheetnames:
        if name != sheet and name in before_f.sheetnames and sheet_values(after_f[name]) != sheet_values(before_f[name]):
            errors.append('other sheet changed: ' + name)
        for row in after_v[name].iter_rows(values_only=True):
            for value in row:
                if isinstance(value, str) and value.strip() in ERROR_VALUES:
                    errors.append('error value ' + value + ' in sheet ' + name)
    header, after_rows, problems = table(after_f[sheet], key_column)
    errors.extend(problems)
    _, before_rows, _ = table(before_f[sheet], key_column) if sheet in before_f.sheetnames else (None, {}, [])
    if header is None or problems:
        return errors
    expected_keys = set()
    for item in expected:
        key = str(item.get('key', '')).strip()
        expected_keys.add(key)
        matches = after_rows.get(key, [])
        if len(matches) != 1:
            errors.append('expected exactly one row for ' + key + ', found ' + str(len(matches)))
            continue
        number, row = matches[0]
        for column, value in (item.get('fields') or {}).items():
            if column not in header:
                errors.append('column ' + repr(column) + ' not in header')
            elif row.get(column) != value:
                errors.append('row ' + str(number) + ' ' + column + ' reads back ' + repr(row.get(column)) + ', expected ' + repr(value))
    for key, rows in before_rows.items():
        if key in expected_keys:
            continue
        if [r for _, r in after_rows.get(key, [])] != [r for _, r in rows]:
            errors.append('unrelated row changed or removed: ' + key)
    for key in set(after_rows) - set(before_rows) - expected_keys:
        errors.append('unexpected new row: ' + key)
    for row_f, row_b in zip(after_f[sheet].iter_rows(), before_f[sheet].iter_rows()):
        for a, b in zip(row_f, row_b):
            if isinstance(b.value, str) and b.value.startswith('=') and a.value != b.value:
                errors.append('formula changed at ' + a.coordinate)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--workbook', required=True, type=Path)
    parser.add_argument('--backup', required=True, type=Path)
    parser.add_argument('--pre-sha256', required=True)
    parser.add_argument('--sheet', required=True)
    parser.add_argument('--key-column', required=True)
    parser.add_argument('--expect', required=True, type=Path)
    args = parser.parse_args()
    try:
        expected = json.loads(args.expect.read_text(encoding='utf-8'))
        if not isinstance(expected, list):
            raise ValueError('expect must be a list')
        errors = check(args.workbook, args.backup, args.pre_sha256, args.sheet, args.key_column, expected)
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({'readback_ok': False, 'errors': [str(exc)]}, ensure_ascii=False))
        return 2
    print(json.dumps({'readback_ok': not errors, 'errors': errors, 'rows_checked': len(expected),
                      'workbook_sha256': sha256(args.workbook)}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
