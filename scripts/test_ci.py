"""CI must retain a Chinese failure and execute later checks on legacy consoles."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class CiDiagnosticsTests(unittest.TestCase):
    def test_legacy_console_failure_keeps_report_and_continues(self):
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / 'ci.json'
            code = '''
import ci, sys
ci.stages = lambda _: {'unit': [
    [sys.executable, '-c', "print('中文失败原因'); raise SystemExit(7)"],
    [sys.executable, '-c', "print('下一项执行成功')"]]}
sys.argv = ['ci.py', '--report', sys.argv[1]]
raise SystemExit(ci.main())
'''
            result = subprocess.run(
                [sys.executable, '-c', code, str(report)],
                cwd=Path(__file__).resolve().parent,
                env=dict(os.environ, PYTHONIOENCODING='cp1252', PYTHONUTF8='0'),
                capture_output=True, encoding='utf-8',
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('中文失败原因', result.stdout)
            data = json.loads(report.read_text(encoding='utf-8'))
            self.assertFalse(data['ci_passed'])
            self.assertEqual([r['returncode'] for r in data['results']], [7, 0])
            self.assertIn('下一项执行成功', data['results'][1]['stdout'])


if __name__ == '__main__':
    unittest.main()
