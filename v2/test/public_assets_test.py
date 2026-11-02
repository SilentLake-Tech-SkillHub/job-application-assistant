import json
import hashlib
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
        for name in ('package.json', 'package-lock.json', 'catalog/entry-recipes.json', 'catalog/workflow-tools.json', 'catalog/role-materials.json', 'catalog/learned-targets.json', 'test/fixtures/insta360.login.json'):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, dest)
    def tearDown(self):
        self.temp.cleanup()
    def test_valid_public_assets(self):
        self.assertEqual(len(public_json_files(self.root)), 7)

    def write_asset(self, name, value):
        (self.root / 'catalog' / name).write_text(json.dumps(value), encoding='utf-8')

    def material_asset(self):
        return json.loads((self.root / 'catalog/role-materials.json').read_text(encoding='utf-8'))

    def learned_asset(self):
        driver = 'phoenix_list_popup.selection'
        selector = ':scope > span.icon-container > svg.CheckboxUnchecked'
        target_id = 'lt-' + hashlib.sha256((driver + '\n' + selector).encode()).hexdigest()[:12]
        return {'revision': 1, 'targets': [{
            'id': target_id, 'driver': driver, 'selector': selector,
            'evidence': {'runId': 'synthetic-run', 'companyId': 'synthetic'},
            'approval': {'at': '2026-10-26T12:00:00.000Z', 'quoteSha256': '0' * 64},
        }]}

    def test_current_package_public_assets_are_valid(self):
        source = Path(__file__).resolve().parents[1]
        self.assertIn('catalog/role-materials.json', public_json_files(source))
        self.assertIn('catalog/learned-targets.json', public_json_files(source))

    def test_material_schema_rejects_values_and_unknown_fields(self):
        original = self.material_asset()
        variants = []
        for key, value in [('schemaVersion', True), ('materials', []), ('facts', {'name': 'applicant'})]:
            data = json.loads(json.dumps(original)); data[key] = value; variants.append(data)
        for key, value in [('key', 'bad key'), ('source', 'identity.name'), ('labels', []),
                           ('value', 'ACTUAL_REFERRAL_CODE'), ('requiredInInventory', 'yes'),
                           ('answer', 'PRIVATE_VALUE')]:
            data = json.loads(json.dumps(original)); data['materials'][0][key] = value; variants.append(data)
        data = json.loads(json.dumps(original)); data['materials'].append(data['materials'][0].copy()); variants.append(data)
        for data in variants:
            with self.subTest(data=data), self.assertRaises(AssertionError):
                self.write_asset('role-materials.json', data)
                public_json_files(self.root)

    def test_material_labels_cannot_hide_personal_data_or_domains(self):
        original = self.material_asset()
        for value in ['13800001234', 'private@example.test', '/Users/private/profile.json',
                      '/Volumes/private/data', 'https://jobs.example.test']:
            data = json.loads(json.dumps(original)); data['materials'][0]['labels'] = [value]
            with self.subTest(value=value), self.assertRaises(AssertionError):
                self.write_asset('role-materials.json', data)
                public_json_files(self.root)

    def test_learned_target_with_typed_evidence_and_hashed_approval_is_valid(self):
        data = self.learned_asset()
        # A typed hash may contain a long digit sequence; it is not a phone field.
        data['targets'][0]['approval']['quoteSha256'] = '13800001234' + '0' * 53
        self.write_asset('learned-targets.json', data)
        self.assertIn('catalog/learned-targets.json', public_json_files(self.root))

    def test_learned_target_schema_is_closed_and_requires_approval(self):
        original = self.learned_asset()
        variants = []
        for key, value in [('revision', True), ('targets', {}), ('profile', {'facts': {}})]:
            data = json.loads(json.dumps(original)); data[key] = value; variants.append(data)
        for key, value in [('driver', 'arbitrary_driver'), ('selector', '#outside'),
                           ('id', 'lt-000000000000'), ('privateFacts', {'name': 'applicant'})]:
            data = json.loads(json.dumps(original)); data['targets'][0][key] = value; variants.append(data)
        for section, key, value in [('evidence', 'runId', '/Users/private/run'),
                                    ('evidence', 'companyId', '13800001234'),
                                    ('evidence', 'email', 'private@example.test'),
                                    ('approval', 'at', 'not-a-date'),
                                    ('approval', 'at', '2026-10-26T12:00:00'),
                                    ('approval', 'quoteSha256', 'private@example.test'),
                                    ('approval', 'quote', 'PRIVATE_QUOTE')]:
            data = json.loads(json.dumps(original)); data['targets'][0][section][key] = value; variants.append(data)
        data = json.loads(json.dumps(original)); del data['targets'][0]['approval']; variants.append(data)
        data = json.loads(json.dumps(original)); data['targets'].append(data['targets'][0].copy()); variants.append(data)
        for data in variants:
            with self.subTest(data=data), self.assertRaises(AssertionError):
                self.write_asset('learned-targets.json', data)
                public_json_files(self.root)

    def test_learned_targets_reject_generated_style_classes(self):
        for selector in [':scope > svg.sc-a1b2c3', ':scope > span.title___a1B2c', ':scope > svg.css-1q2w3e4']:
            data = self.learned_asset(); target = data['targets'][0]; target['selector'] = selector
            target['id'] = 'lt-' + hashlib.sha256((target['driver'] + '\n' + selector).encode()).hexdigest()[:12]
            with self.subTest(selector=selector), self.assertRaises(AssertionError):
                self.write_asset('learned-targets.json', data)
                public_json_files(self.root)

    def test_runtime_records_are_still_rejected(self):
        directory = self.root / 'runs'; directory.mkdir()
        (directory / 'synthetic-run.json').write_text('{"status":"verified"}', encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)
    def test_private_profile_is_rejected(self):
        (self.root / 'profile.private.json').write_text('{"facts":{}}', encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)
    def test_personal_answer_hidden_in_asset_is_rejected(self):
        p = self.root / 'test/fixtures/insta360.login.json'
        c = json.loads(p.read_text(encoding='utf-8'))
        c['account']['phone'] = '13800001234'
        p.write_text(json.dumps(c), encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)
    def test_company_catalog_in_package_is_rejected(self):
        (self.root / 'catalog/companies.json').write_text('{"schemaVersion":1,"companies":[]}', encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)

    def test_hardcoded_domain_in_entry_recipe_is_rejected(self):
        p = self.root / 'catalog/entry-recipes.json'
        d = json.loads(p.read_text(encoding='utf-8'))
        d['recipes']['feishu_campus_detail_to_form']['host'] = 'https://example.jobs.feishu.cn'
        p.write_text(json.dumps(d), encoding='utf-8')
        with self.assertRaises(AssertionError):
            public_json_files(self.root)

    def test_unknown_data_in_workflow_manifest_is_rejected(self):
        p = self.root / 'catalog/workflow-tools.json'
        d = json.loads(p.read_text(encoding='utf-8'))
        d['privateFacts'] = {'name': 'applicant'}
        p.write_text(json.dumps(d), encoding='utf-8')
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
