#!/usr/bin/env python3
"""Playwright lane executor on the synthetic recruiting site (real headless Chromium).

Covers: login kept in a persistent profile, the whole form filled from 填写方案.json with per-field
readback, an interrupted run resumed from the cache (including a page reloaded without saving),
the draft-save step, refusing a submit-like click, and rejecting plans for other lanes.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE / 'fixtures'))
import fill_plan  # noqa: E402
from synthetic_ats import serve  # noqa: E402

ENV = dict(os.environ, PYTHONIOENCODING='utf-8')
EXE = os.environ.get('CHROME_EXECUTABLE') or None


def plan_for(base, job='101'):
    return {
        '方案版本': 1, '批次': 'pw', '公司': '合成公司', '岗位链接': base + '/jobs/' + job, '表单链接': base + '/apply/' + job,
        '通道': 'Playwright',
        '字段': [
            {'序号': 1, '标签': '简历附件 *', '定位': {'label': '简历附件 *'}, '控件': '上传', '填法': '上传', '值来源': '材料:简历',
             '读回定位': {'css': '#resume-name'}, '读回方式': '文本', '必填': True, '状态': '待填'},
            {'序号': 2, '标签': '姓名 *', '定位': {'label': '姓名 *'}, '控件': '文本', '填法': '批量', '值': '合成候选人', '必填': True, '状态': '待填'},
            {'序号': 3, '标签': '学历 *', '定位': {'role': 'combobox', 'name': '学历 *'}, '控件': '下拉', '填法': '点击', '值': '硕士',
             '点击步骤': [{'点击': {'role': 'combobox', 'name': '学历 *'}}, {'选项': '硕士'}], '读回定位': {'css': '.combo input'}, '必填': True, '状态': '待填'},
            {'序号': 4, '标签': '毕业时间 *', '定位': {'label': '毕业时间 *'}, '控件': '日期', '填法': '点击', '值': '2026-06',
             '点击步骤': [{'点击': {'label': '毕业时间 *'}}, {'选项': '2026-06'}], '读回定位': {'label': '毕业时间 *'}, '必填': True, '状态': '待填'},
            {'序号': 5, '标签': '项目经历 *', '定位': {'label': '项目经历 *'}, '控件': '多行文本', '填法': '批量',
             '值': '合成项目：负责 AI 产品需求、方案与迭代，指标提升 20%。', '必填': True, '状态': '待填'},
            {'序号': 6, '标签': '第一意向部门 *', '定位': {'label': '第一意向部门 *'}, '控件': '原生下拉', '填法': '批量', '值': '合成智能事业群',
             '必填': True, '状态': '待填'},
            {'序号': 7, '标签': '我已阅读并同意《合成隐私条款》 *', '定位': {'label': '我已阅读并同意《合成隐私条款》 *'}, '控件': '复选', '填法': '批量',
             '值': True, '必填': True, '状态': '待填'},
        ],
        '保存步骤': [{'点击': {'role': 'button', 'name': '保存草稿'}}],
    }


class Executor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        (cls.root / '投递证据' / 'pw' / '批次').mkdir(parents=True)
        (cls.root / '简历.pdf').write_bytes(b'%PDF synthetic resume')
        digest = hashlib.sha256((cls.root / '简历.pdf').read_bytes()).hexdigest()
        (cls.root / '投递证据' / 'pw' / '批次' / 'Query.md').write_text('## 材料\n- 简历 | 简历.pdf | ' + digest + '\n', encoding='utf-8')
        cls.base, cls.site, cls.server = serve()
        cls.profile = cls.root / '.浏览器配置' / 'playwright'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.tmp.cleanup()

    def run_exec(self, plan_path, *extra):
        r = subprocess.run([sys.executable, str(HERE / 'playwright_fill.py'), '--plan', str(plan_path), '--headless',
                            '--profile-dir', str(self.profile), '--timeout', '4000', *extra],
                           capture_output=True, text=True, encoding='utf-8', env=ENV)
        try:
            return r.returncode, json.loads(r.stdout)
        except ValueError:
            self.fail('executor output not JSON:\n' + r.stdout + r.stderr)

    def write_plan(self, name, plan):
        folder = self.root / '投递证据' / 'pw' / '岗位' / name
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / fill_plan.PLAN_NAME
        fill_plan.save(path, plan)
        self.assertEqual(fill_plan.validate(plan, ready=True), [])
        return path

    def login_in_profile(self):
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(str(self.profile), headless=True, executable_path=EXE)
            page = ctx.new_page()
            page.goto(self.base + '/login')
            page.get_by_role('button', name='登录').click()  # browser-prefilled account; the script never logs in
            page.wait_for_url(self.base + '/center')
            ctx.close()

    def read_draft(self):
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(str(self.profile), headless=True, executable_path=EXE)
            page = ctx.new_page()
            page.goto(self.base + '/apply/101'); page.wait_for_selector('#save')
            out = {'姓名': page.get_by_label('姓名 *').input_value(), '学历': page.locator('.combo input').input_value(),
                   '毕业时间': page.get_by_label('毕业时间 *').input_value(), '项目经历': page.get_by_label('项目经历 *').input_value(),
                   '第一意向': page.get_by_label('第一意向部门 *').input_value(),
                   '条款': page.get_by_label('我已阅读并同意《合成隐私条款》 *').is_checked(), '附件': page.locator('#resume-name').inner_text()}
            ctx.close()
        return out

    def test_1_needs_login_in_the_profile_first(self):
        path = self.write_plan('login', plan_for(self.base))
        code, out = self.run_exec(path)
        self.assertEqual(code, 3, out)
        self.assertIn('登录', out['错误'][0])
        self.assertTrue(all(f['状态'] == '待填' for f in fill_plan.load(path)['字段']))

    def test_2_fill_interrupt_resume_and_save(self):
        self.login_in_profile()
        path = self.write_plan('main', plan_for(self.base))
        code, out = self.run_exec(path, '--max-fields', '3')  # interrupted after three fields
        self.assertEqual(code, 0, out)
        cached = fill_plan.load(path)
        self.assertEqual([f['状态'] for f in cached['字段']], ['已读回'] * 3 + ['待填'] * 4)
        self.assertEqual(out['保存'], None)  # nothing saved while fields are left
        # Resume in a new browser session: the page reloads without the unsaved values, so the cached
        # 已读回 fields are re-checked, found missing and filled again together with the rest.
        code, out = self.run_exec(path)
        self.assertEqual(code, 0, out)
        self.assertEqual(set(out['续跑复核重填']), {'简历附件 *', '姓名 *', '学历 *'})
        self.assertIn('已点击保存', out['保存'])
        final = fill_plan.load(path)
        self.assertTrue(all(f['状态'] == '已读回' for f in final['字段']), final)
        draft = self.read_draft()
        self.assertEqual(draft, {'姓名': '合成候选人', '学历': '硕士', '毕业时间': '2026-06',
                                 '项目经历': '合成项目：负责 AI 产品需求、方案与迭代，指标提升 20%。', '第一意向': '合成智能事业群',
                                 '条款': True, '附件': '简历.pdf'})  # the résumé parse pollution was corrected
        self.assertEqual(self.site.history, [])  # never submitted
        out_md = fill_plan.export_readback(path)
        self.assertIn(fill_plan.plan_hash(path), out_md.read_text(encoding='utf-8'))
        # A third run finds everything on the page and does nothing.
        code, out = self.run_exec(path)
        self.assertEqual((code, out['续跑复核重填'], out['本次已读回']), (0, [], []))

    def test_3_refuses_a_submit_like_click(self):
        self.login_in_profile()
        plan = plan_for(self.base, '102')
        plan['字段'] = [dict(plan['字段'][1], 序号=1), {'序号': 2, '标签': '学历 *', '定位': {'css': '#form-root'}, '控件': '下拉', '填法': '点击', '值': '硕士',
                                                  '点击步骤': [{'点击': {'css': '#submit'}}], '读回定位': {'css': '.combo input'}, '状态': '待填'}]
        plan.pop('保存步骤')
        path = self.write_plan('refuse', plan)
        code, out = self.run_exec(path)
        self.assertEqual(code, 1, out)
        field = fill_plan.load(path)['字段'][1]
        self.assertEqual(field['状态'], '不一致')
        self.assertIn('拒绝点击', field['备注'])
        self.assertEqual(self.site.history, [])

    def test_4_other_lanes_use_batch_actions_not_the_executor(self):
        plan = plan_for(self.base); plan['通道'] = 'Chrome'
        code, out = self.run_exec(self.write_plan('chrome', plan))
        self.assertEqual(code, 2)
        self.assertIn('fill_plan.py actions', out['错误'][0])


if __name__ == '__main__':
    unittest.main()
