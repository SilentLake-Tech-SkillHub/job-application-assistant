#!/usr/bin/env python3
"""Five real-browser mock templates and production mapping/plan/recipe contracts."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
import fill_plan
from compile_form_mapping import compile_plan
from form_test_support import chrome_path, execute_case, map_form, scan
from fixtures.form_sites import serve, SITES, EXPECTED


class Forms(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server, cls.state, cls.base = serve()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.resume = Path(cls.tmp.name) / 'synthetic-resume.pdf'
        cls.resume.write_bytes(b'%PDF-1.4\n% synthetic test attachment only\n')
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, executable_path=chrome_path())

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close(); cls.tmp.cleanup()

    def test_five_templates_baseline_cold_warm(self):
        for site in SITES:
            with self.subTest(site=site):
                page = self.browser.new_page()
                try:
                    url = self.base + '/forms/' + site
                    baseline = execute_case(page, site, url, 'baseline', self.resume)
                    cold = execute_case(page, site, url, 'enhanced', self.resume)
                    warm = execute_case(page, site, url, 'enhanced', self.resume, cold['cache'])
                    for case in (baseline, cold, warm):
                        self.assertTrue(case['receipt_verified'])
                        self.assertEqual(case['correct_fields'], len(EXPECTED[site]))
                    # Upload rescans explicitly, so its final per-page cache result is cold.
                    if site != 'upload-rerender':
                        self.assertTrue(warm['cache_hit'])
                finally:
                    page.close()

    def test_compiler_routes_all_actual_lanes_and_privacy(self):
        page = self.browser.new_page()
        try:
            url = self.base + '/forms/native-bilingual'
            page.goto(url); inventory = scan(page); mapping = map_form(inventory, url)['mapping']
            for lane in fill_plan.LANES:
                plan = compile_plan(inventory, mapping, 'test', '合成公司', url, lane)
                self.assertEqual(plan['通道'], lane)
                self.assertFalse(fill_plan.validate(plan))
                phone = next(f for f in plan['字段'] if 'Mobile' in f['标签'])
                self.assertIn('privacy-info-fill', fill_plan.blocked_reason(phone))
                self.assertNotIn('值', phone)
                self.assertNotIn('保存步骤', plan)
            edited = json.loads(json.dumps(mapping)); edited['fields'][0]['source'] = '档案:wrong'
            with self.assertRaises(ValueError):
                compile_plan(inventory, edited, 'test', '合成公司', url, 'Chrome')
        finally:
            page.close()

    def test_typed_dropdown_text_does_not_create_selection(self):
        page = self.browser.new_page()
        try:
            page.goto(self.base + '/forms/search-dropdown')
            page.locator('#school-search').fill('合成本科大学')
            with page.expect_response(lambda r: '/api/draft/' in r.url) as response:
                page.locator('#save').click()
            self.assertEqual(response.value.status, 422)
        finally:
            page.close()

    def test_no_submit_in_mapping_or_plan(self):
        page = self.browser.new_page()
        try:
            url = self.base + '/forms/date-cascade'; page.goto(url)
            inventory = scan(page); mapping = map_form(inventory, url)['mapping']
            self.assertFalse(any(f['label'] == '提交申请' for f in mapping['fields']))
            plan = compile_plan(inventory, mapping, 'test', '合成公司', url, '内置浏览器')
            self.assertFalse(any(f['定位'].get('css') == '#submit' for f in plan['字段']))
            self.assertTrue(any(f['状态'] == '需用户' for f in plan['字段']))
        finally:
            page.close()


if __name__ == '__main__':
    unittest.main()
