import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from check_public_assets import public_json_files

class PublicAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = Path(__file__).resolve().parents[1]
        for name in ('package.json', 'package-lock.json', 'catalog/companies.json', 'companies/insta360.login.json'):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, dest)
    def tearDown(self):
        self.temp.cleanup()
    def test_valid_public_assets(self):
        self.assertEqual(len(public_json_files(self.root)), 4)
    def test_private_profile_is_rejected(self):
        (self.root / 'profile.private.json').write_text('{"facts":{}}', encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)
    def test_personal_answer_hidden_in_asset_is_rejected(self):
        p = self.root / 'companies/insta360.login.json'
        c = json.loads(p.read_text(encoding='utf-8'))
        c['account']['phone'] = '13800001234'
        p.write_text(json.dumps(c), encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)
    def test_manifest_mismatch_is_rejected(self):
        p = self.root / 'package-lock.json'
        d = json.loads(p.read_text(encoding='utf-8'))
        d['version'] = 'wrong'
        p.write_text(json.dumps(d), encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)

if __name__ == '__main__':
    unittest.main()
