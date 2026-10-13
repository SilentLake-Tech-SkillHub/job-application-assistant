#!/usr/bin/env python3
"""填写方案.json (fill cache): schema whitelist, privacy, skeleton/template round trip, batch actions,
progress marks and readback export. Synthetic data only."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fill_plan as fp  # noqa: E402

ENV = dict(os.environ, PYTHONIOENCODING='utf-8')
INVENTORY = {'fields': [
    {'index': 0, 'label': '姓名 *', 'labelSource': 'label', 'locator': '#name-1', 'kind': 'text', 'evidence': ['input', 'input_type=text'], 'required': True},
    {'index': 1, 'label': '学历 *', 'labelSource': 'aria-labelledby', 'locator': '#deg-1', 'kind': 'select', 'evidence': ['div', 'role=combobox'], 'required': True},
    {'index': 2, 'label': '毕业时间 *', 'labelSource': 'label', 'locator': '#grad-1', 'kind': 'readonly_input', 'evidence': ['input', 'readonly'], 'required': True},
    {'index': 3, 'label': '简历附件 *', 'labelSource': 'label', 'locator': '#resume-1', 'kind': 'file', 'evidence': ['input', 'input_type=file'], 'required': True},
    {'index': 4, 'label': '项目经历 *', 'labelSource': 'label', 'locator': '#project-1', 'kind': 'text', 'evidence': ['textarea'], 'required': True},
    {'index': 5, 'label': '第一意向部门 *', 'labelSource': 'label', 'locator': '#slot1-1', 'kind': 'select', 'evidence': ['select'], 'required': True},
    {'index': 6, 'label': '我已阅读并同意', 'labelSource': 'label', 'locator': '#terms-1', 'kind': 'checkbox', 'evidence': ['input', 'input_type=checkbox'], 'required': True},
    {'index': 7, 'label': '身份证号 *', 'labelSource': 'label', 'locator': '#id-1', 'kind': 'text', 'evidence': ['input'], 'required': True},
    {'index': 8, 'label': '', 'labelSource': 'unresolved', 'locator': 'body > button:nth-of-type(1)', 'kind': 'button', 'evidence': ['button']},
]}


def plan(**over):
    p = {'方案版本': 1, '批次': 'b1', '公司': '合成公司A', '岗位链接': 'https://example.test/jobs/101', '通道': '内置浏览器',
         '字段': [{'序号': 1, '标签': '姓名 *', '定位': {'label': '姓名 *'}, '控件': '文本', '填法': '批量', '值': '合成候选人', '状态': '待填'}]}
    p.update(over)
    return p


class SchemaTests(unittest.TestCase):
    def test_minimal_plan_is_valid(self):
        self.assertEqual(fp.validate(plan()), [])

    def test_whitelist_keeps_state_out(self):
        for key in ('投递状态', '盘点状态', '回执', '批准', '审核包哈希', 'status'):
            self.assertTrue(any('不属于填写缓存的键 ' + key in e for e in fp.validate(plan(**{key: 'x'}))), key)
        p = plan(); p['字段'][0]['投递状态'] = '已提交'
        self.assertTrue(any('不属于填写缓存的键 投递状态' in e for e in fp.validate(p)))

    def test_batch_only_for_native_controls(self):
        p = plan(); p['字段'][0].update(控件='下拉')
        self.assertTrue(any('不能批量填写' in e for e in fp.validate(p)))
        p['字段'][0].update(填法='点击')
        self.assertTrue(any('点击步骤' in e for e in fp.validate(p)))
        self.assertTrue(any('读回定位' in e for e in fp.validate(p)))

    def test_plan_cannot_carry_a_submit_click(self):
        p = plan(); p['字段'][0].update(控件='下拉', 填法='点击', 点击步骤=[{'点击': {'role': 'button', 'name': '提交申请'}}], 读回定位={'css': '#x'})
        self.assertTrue(any('提交' in e for e in fp.validate(p)))
        p = plan(保存步骤=[{'点击': {'role': 'button', 'name': '确认投递'}}])
        self.assertTrue(any('提交' in e for e in fp.validate(p)))
        self.assertEqual(fp.validate(plan(保存步骤=[{'点击': {'role': 'button', 'name': '保存草稿'}}])), [])

    def test_privacy_rules(self):
        p = plan(); p['字段'][0].update(标签='手机号 *', 定位={'label': '手机号 *'}, 值='13800000000')
        self.assertTrue(any('个人敏感信息' in e for e in fp.validate(p)))
        p['字段'][0].pop('值'); p['字段'][0]['值来源'] = '档案:手机号'
        self.assertEqual(fp.validate(p), [])
        p['字段'][0]['读回'] = '13800000000'
        self.assertTrue(any('读回只写 一致/不一致' in e for e in fp.validate(p)))
        q = plan(); q['字段'][0].update(标签='短信验证码', 定位={'label': '短信验证码'}, 值='123456')
        self.assertTrue(any('永不记录' in e for e in fp.validate(q)))
        q['字段'][0].update(填法='用户', 值=None)
        self.assertEqual(fp.validate(q), [])

    def test_locator_value_source_and_states(self):
        p = plan(); p['字段'][0]['定位'] = {'label': 'a', 'css': '#a'}
        self.assertTrue(any('只需要' in e for e in fp.validate(p)))
        p = plan(); p['字段'][0]['值来源'] = '网页:猜'
        self.assertTrue(any('值来源' in e for e in fp.validate(p)))
        p = plan(); p['字段'][0].update(状态='完成')
        self.assertTrue(any('状态须为' in e for e in fp.validate(p)))
        p = plan(); p['字段'][0].update(状态='跳过', 必填=True)
        self.assertTrue(any('不能「跳过」' in e for e in fp.validate(p)))
        p = plan(); p['字段'][0].update(值=None)
        self.assertEqual(fp.validate(p), [])
        self.assertTrue(any('还没有值' in e for e in fp.validate(p, ready=True)))

    def test_bad_shapes_do_not_crash(self):
        for bad in ([], 'x', {'字段': 'x'}, {'字段': [1, None, {}]}, plan(字段=[{'序号': 'a', '定位': 3, '依赖': 'x'}])):
            self.assertIsInstance(fp.validate(bad), list)


class BuildTests(unittest.TestCase):
    def test_skeleton_from_control_inventory(self):
        p = fp.from_inventory(INVENTORY, 'b1', '合成公司A', 'https://example.test/jobs/101', 'Playwright')
        by = {f['标签']: f for f in p['字段']}
        self.assertEqual(p['字段'][0]['控件'], '上传')  # uploads (which auto-parse) go first
        self.assertEqual((by['姓名 *']['控件'], by['姓名 *']['填法']), ('文本', '批量'))
        self.assertEqual((by['项目经历 *']['控件'], by['项目经历 *']['填法']), ('多行文本', '批量'))
        self.assertEqual((by['学历 *']['控件'], by['学历 *']['填法']), ('下拉', '点击'))
        self.assertEqual((by['第一意向部门 *']['控件'], by['第一意向部门 *']['填法']), ('原生下拉', '批量'))
        self.assertEqual((by['我已阅读并同意']['控件'], by['我已阅读并同意']['填法']), ('复选', '批量'))
        self.assertEqual((by['身份证号 *']['填法'], by['身份证号 *']['状态']), ('用户', '需用户'))
        self.assertNotIn('', by)  # buttons are not fields
        self.assertEqual(fp.validate(p), [])

    def test_widget_display_input_is_not_a_second_field(self):
        inv = {'fields': INVENTORY['fields'] + [{'index': 9, 'label': '学历 *', 'labelSource': 'aria-labelledby', 'locator': '#deg-input-1',
                                                 'kind': 'readonly_input', 'evidence': ['input', 'readonly']}]}
        p = fp.from_inventory(inv, 'b1', 'A', 'https://e.test/1', 'Chrome')
        self.assertEqual([f['标签'] for f in p['字段']].count('学历 *'), 1)
        p['字段'].append(dict(p['字段'][1], 序号=50))
        self.assertTrue(any('指向同一个控件' in e for e in fp.validate(p)))

    def test_template_round_trip_drops_values_and_progress(self):
        p = fp.from_inventory(INVENTORY, 'b1', '合成公司A', 'https://jobs.example.test/apply/1', 'Playwright')
        p['字段'][1].update(值='合成候选人', 状态='已读回', 读回='合成候选人')
        t = fp.to_template(p)
        self.assertEqual(t['站点'], 'jobs.example.test')
        self.assertEqual(fp.validate_template(t), [])
        dumped = json.dumps(t, ensure_ascii=False)
        self.assertNotIn('合成候选人', dumped)
        self.assertNotIn('已读回', dumped)
        again = fp.from_template(t, 'b2', '合成公司B', 'https://jobs.example.test/apply/2', 'Chrome')
        self.assertEqual([f['标签'] for f in again['字段']], [f['标签'] for f in p['字段']])
        self.assertTrue(all(f['状态'] in ('待填', '需用户') for f in again['字段']))
        t['字段'][0]['值'] = 'x'
        self.assertTrue(any('不带个人取值' in e for e in fp.validate_template(t)))


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / '投递证据' / 'b1' / '批次').mkdir(parents=True)
        (self.root / '投递证据' / 'b1' / '批次' / 'Query.md').write_text('## 材料\n- 简历 | 材料/简历.pdf | abc\n', encoding='utf-8')
        self.vault = self.root / '档案.md'
        self.vault.write_text('| 字段 | 取值 | 记录日期 |\n|---|---|---|\n| 手机号 | 13800000000 | 2026-10-13 |\n微信号: synthetic_wx\n', encoding='utf-8')
        self.path = self.root / '填写方案.json'
        p = fp.from_inventory(INVENTORY, 'b1', '合成公司A', 'https://example.test/jobs/101', '内置浏览器')
        for f in p['字段']:
            if f['标签'] == '姓名 *':
                f['值'] = '合成候选人'
            if f['标签'] == '项目经历 *':
                f['值'] = '合成项目'
            if f['控件'] == '上传':
                f['值来源'] = '材料:简历'
        p['字段'].append({'序号': 99, '标签': '手机号 *', '定位': {'label': '手机号 *'}, '控件': '文本', '填法': '批量', '值来源': '档案:手机号', '状态': '待填'})
        fp.save(self.path, p)

    def tearDown(self):
        self.tmp.cleanup()

    def test_vault_and_material_resolution(self):
        values = fp.vault_values(self.vault)
        self.assertEqual(values['手机号'], '13800000000')
        self.assertEqual(values['微信号'], 'synthetic_wx')
        upload = next(f for f in fp.load(self.path)['字段'] if f['控件'] == '上传')
        self.assertTrue(fp.resolve(upload, values, self.root, 'b1').endswith(str(Path('材料') / '简历.pdf')))

    def test_actions_group_batch_fields_and_isolate_clicks(self):
        groups = fp.actions(fp.load(self.path), fp.vault_values(self.vault), self.root)
        kinds = [g['类型'] for g in groups]
        self.assertEqual(kinds[0], '上传')
        self.assertIn('点击', kinds)
        self.assertIn('交接用户', kinds)
        batch = [g for g in groups if g['类型'] == '批量']
        self.assertTrue(any(len(g['字段']) >= 2 for g in batch))
        phone = [f for g in batch for f in g['字段'] if f['标签'] == '手机号 *']
        self.assertEqual(phone[0]['值'], '13800000000')  # resolved at run time, never stored in the plan
        self.assertNotIn('13800000000', self.path.read_text(encoding='utf-8'))

    def test_mark_resume_and_export(self):
        p = fp.load(self.path)
        fp.mark(p, 2, '已读回', '合成候选人')
        phone = next(f for f in p['字段'] if f['标签'] == '手机号 *')
        fp.mark(p, phone['序号'], '已读回', '13800000000')
        self.assertEqual(phone['读回'], '一致')  # sensitive readback is never copied
        fp.save(self.path, p)
        left = fp.pending(fp.load(self.path))
        self.assertNotIn('手机号 *', [f['标签'] for f in left])
        out = fp.export_readback(self.path)
        text = out.read_text(encoding='utf-8')
        self.assertIn('方案哈希: ' + fp.plan_hash(self.path), text)
        self.assertNotIn('13800000000', text)
        with self.assertRaises(ValueError):
            fp.mark(p, 2, '完成')

    def test_cli(self):
        def run(*args):
            r = subprocess.run([sys.executable, str(HERE / 'fill_plan.py'), *args], capture_output=True, text=True, encoding='utf-8', env=ENV)
            return r.returncode, json.loads(r.stdout)
        code, out = run('check', str(self.path))
        self.assertEqual(code, 0, out)
        code, out = run('check', str(self.path), '--ready')
        self.assertEqual(code, 1)  # 学历 / 毕业时间 / 意向 / 条款 still have no value
        code, out = run('pending', str(self.path))
        self.assertGreater(out['未完成'], 0)
        code, out = run('mark', str(self.path), '--field', '2', '--status', '已读回', '--readback', '合成候选人')
        self.assertEqual(code, 0, out)
        code, out = run('actions', str(self.path), '--vault', str(self.vault), '--root', str(self.root))
        self.assertTrue(out['动作'])
        code, out = run('template', str(self.path), '--out', str(self.root / '站点模板' / 'x.json'))
        self.assertEqual(code, 0, out)
        code, out = run('from-template', str(self.root / '站点模板' / 'x.json'), '--batch', 'b2', '--company', 'C', '--url', 'https://e.test/1',
                        '--lane', 'Chrome', '--out', str(self.root / 'p2.json'))
        self.assertEqual(code, 0, out)
        inv = self.root / 'inv.json'; inv.write_text(json.dumps(INVENTORY, ensure_ascii=False), encoding='utf-8')
        code, out = run('skeleton', str(inv), '--batch', 'b1', '--company', 'A', '--url', 'https://e.test/2', '--lane', 'Playwright', '--out', str(self.root / 'p3.json'))
        self.assertEqual((code, out['错误']), (0, []))
        code, out = run('export', str(self.path))
        self.assertEqual(code, 0, out)


if __name__ == '__main__':
    unittest.main()
