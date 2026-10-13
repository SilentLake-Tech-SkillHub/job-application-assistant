#!/usr/bin/env python3
"""Excel + 投递证据/ checks. Issue #25 regressions first, then one test per review item. Synthetic data only."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'fixtures'))
from workspace import Workspace  # noqa: E402
from batch_check import Batch  # noqa: E402
from stage_gate import run as gate  # noqa: E402
from workbook_state import Workbook, canonical_url, INVENTORY_STATUSES  # noqa: E402
from evidence_layout import parse, value, list_items, ref_exists, role_dir  # noqa: E402

U1, U2, U3 = 'https://example.test/jobs/101', 'https://example.test/jobs/102', 'https://example.test/jobs/103'
A, B = '合成公司A', '合成公司B'
ENV = dict(os.environ, PYTHONIOENCODING='utf-8')


def has(errors, needle):
    return any(needle in e for e in errors)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = Workspace(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def batch(self):
        return Batch(self.w.book, 'b1')

    def errors(self):
        return self.batch().consistency_errors()

    def ready(self, company=A, url=U1, **kw):
        self.w.tag(company, '已有相关岗位记录')
        self.w.add_role(company, url, **kw)
        self.w.company_ready(company)
        self.w.role_ready(company, url)

    def submitted(self, company=A, url=U1):
        self.ready(company, url)
        self.w.role_prepared(company, url)
        self.w.role_approved(company, url)
        self.w.role_submitted(company, url)


class Issue25LabelTests(Base):
    """#25: the tracker labels are the state. Scanned ⇒ tagged; receipt ⇔ 已提交."""

    def test_fresh_workspace_is_consistent(self):
        self.assertEqual(self.errors(), [])

    def test_scanned_company_must_carry_a_label(self):
        self.w.company_ready(A)  # the Agent visited A and wrote evidence...
        self.assertTrue(has(self.errors(), '合成公司A 已经扫描过，但「校招计划」盘点状态仍是「尚未推进」'))
        for status in ('无当年校招计划', '无用户要求岗位', '无法访问校招页面'):
            self.w.tag(A, status)
            self.assertEqual(self.errors(), [], status)

    def test_label_values_are_the_five_fixed_ones(self):
        self.w.tag(A, '访问受阻')  # legacy wording from an old copy
        self.assertTrue(has(self.errors(), '不是五个固定值之一'))
        self.assertEqual(len(INVENTORY_STATUSES), 5)

    def test_relevant_roles_label_needs_role_rows(self):
        self.w.tag(A, '已有相关岗位记录')
        self.assertTrue(has(self.errors(), '已有相关岗位记录，但岗位表里没有带直链的岗位行'))
        self.w.add_role(A, U1)
        self.assertEqual(self.errors(), [])

    def test_receipt_must_be_booked_as_submitted(self):
        self.submitted()
        self.assertEqual(self.errors(), [])
        self.w.set_apply_status(U1, '待投递')
        self.assertTrue(has(self.errors(), '有回执，但岗位表投递状态仍是「待投递」'))

    def test_submitted_needs_receipt_and_readback(self):
        self.ready(); self.w.role_prepared(A, U1)
        self.w.set_apply_status(U1, '已提交')
        errors = self.errors()
        self.assertTrue(has(errors, '投递状态为「已提交」，但'))
        self.assertTrue(has(errors, '追踪表读回.md 不存在'))

    def test_apply_status_values_and_placeholder_rule(self):
        self.ready(); self.w.set_apply_status(U1, '已投')
        self.assertTrue(has(self.errors(), '投递状态应为 待投递 或 已提交'))

    def test_every_gate_enforces_label_consistency(self):
        self.submitted()
        self.w.set_apply_status(U1, '待投递')
        self.w.tag(B, '已有相关岗位记录'); self.w.add_role(B, U2); self.w.company_ready(B); self.w.role_ready(B, U2)
        result = gate(self.w.book, 'b1', 'prepare', U2)
        self.assertFalse(result['允许'])
        self.assertTrue(has(result['错误'], '回执要入账为「已提交」'))

    def test_role_evidence_without_tracker_row_is_rejected(self):
        role_dir(self.w.root, 'b1', A, U3).mkdir(parents=True)
        self.assertTrue(has(self.errors(), '找不到对应的岗位表行'))


class QueryTests(Base):
    """C10 / 1.1–1.10: the must-ask Query items live in 批次/Query.md, each backed by a user record."""

    def test_missing_query_file(self):
        (self.w.bdir / '批次' / 'Query.md').unlink()
        self.assertTrue(has(self.batch().query_errors(), 'Query.md 不存在'))

    def test_each_section_needs_basis_file(self):
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 授权='选岗授权: 是\n准备授权: 是\n依据: 口头')
        text = (self.w.bdir / '批次' / 'Query.md').read_text(encoding='utf-8').replace(
            '## 授权\n选岗授权: 是\n准备授权: 是\n依据: 口头\n依据: ', '## 授权\n选岗授权: 是\n准备授权: 是\n依据: 口头\n备注: ')
        (self.w.bdir / '批次' / 'Query.md').write_text(text, encoding='utf-8')
        self.assertTrue(has(self.batch().query_errors(), '「授权」节的「依据:」必须指向'))

    def test_missing_section(self):
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 自动化授权=None)
        self.assertTrue(has(self.batch().query_errors(), '缺少「## 自动化授权」节'))

    def test_research_entry_rejected(self):
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 入口='类型: 研究')
        self.assertTrue(has(self.batch().query_errors(), '入口类型必须是「投递」'))

    def test_material_hash_must_match_file(self):
        (self.w.root / '简历.pdf').write_bytes(b'changed resume')
        self.assertTrue(has(self.batch().query_errors(), 'sha256 与文件不一致'))

    def test_targets_must_match_buckets_and_null_needs_stop(self):
        self.w.write_query('大厂=1', '补位', '有合格岗位的公司')
        self.assertTrue(has(self.batch().query_errors(), '不一致'))
        self.w.write_query('大厂=无, 银行=1', '补位', '有合格岗位的公司',
                           目标与停止条件='计数口径: 有合格岗位的公司\n补位规则: 补位\n目标: 大厂=无, 银行=1')
        self.assertTrue(has(self.batch().query_errors(), '需要「停止条件:」'))

    def test_automation_consistency(self):
        cases = [
            ('模式: 不开启\n已开启: captcha-solve\n条款方式: 逐项查看', '不开启时「已开启」应为 无'),
            ('模式: 全自动\n已开启: captcha-solve\n条款方式: 逐项查看', '全自动必须开启全部五个'),
            ('模式: 半自动\n已开启: 无\n条款方式: 逐项查看', '半自动需要列出'),
            ('模式: 半自动\n已开启: terms-consent\n条款方式: 全部代勾', '三次确认'),
            ('模式: 半自动\n已开启: terms-consent', '条款方式'),
            ('模式: 半自动\n已开启: 别的skill\n条款方式: 逐项查看', '五个自动化子 Skill 的名字'),
        ]
        for text, needle in cases:
            self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 自动化授权=text)
            self.assertTrue(has(self.batch().query_errors(), needle), needle)
        for i in (1, 2, 3):
            self.w.say('条款代勾-%d' % i)
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 自动化授权='模式: 半自动\n已开启: terms-consent\n条款方式: 全部代勾')
        self.assertEqual(self.batch().query_errors(), [])

    def test_channel_preflight_states(self):
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 能力预检='内置浏览器: 可用')
        self.assertTrue(has(self.batch().query_errors(), 'Chrome: 可用/不可用'))


class PrepareGateTests(Base):
    """2.1–2.6: company rule, order, lane, role package and eligibility before forms."""

    def test_prepare_allowed_with_full_evidence(self):
        self.ready()
        self.assertTrue(gate(self.w.book, 'b1', 'prepare', U1)['允许'])

    def test_company_must_be_tagged_relevant(self):
        self.ready(); self.w.tag(A, '无用户要求岗位')
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U1)['错误'], '盘点状态应为「已有相关岗位记录」'))

    def test_role_outside_company_list(self):
        self.w.edit(lambda wb: wb['中国大陆'].append(['北京', '合成公司Z', 'x', 'y', '岗', '北京', 'jd', 'bu', U3, '待投递']))
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U3)['错误'], '不在本批 Query 的公司清单里'))

    def test_eligibility_pending_needs_user_attempt(self):
        self.ready(); self.w.role_ready(A, U1, conclusion='待核')
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U1)['错误'], '尝试指令'))
        (self.w.role_folder(A, U1) / '尝试指令.md').write_text('依据: x\n', encoding='utf-8')
        self.assertTrue(gate(self.w.book, 'b1', 'prepare', U1)['允许'])

    def test_lane_and_playwright_substitute(self):
        self.ready(); self.w.company_ready(A, lane='Playwright')
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U1)['错误'], 'Playwright代替: 同意'))

    def test_verified_count_rule_needs_limit_source_date(self):
        self.ready()
        self.w.write('投递证据/b1/公司/合成公司A/数量规则.md', '状态: 已核实\n')
        errors = gate(self.w.book, 'b1', 'prepare', U1)['错误']
        for key in ('上限', '来源', '核验日期'):
            self.assertTrue(has(errors, key), key)

    def test_selection_without_authority(self):
        self.ready()
        self.w.write_query('大厂=1, 银行=1', '补位', '有合格岗位的公司', 授权='选岗授权: 否\n准备授权: 是')
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U1)['错误'], '用户选岗.md'))

    def test_already_submitted_role_cannot_reenter(self):
        self.submitted()
        self.assertTrue(has(gate(self.w.book, 'b1', 'prepare', U1)['错误'], '已提交或结果不确定'))


class ReviewSubmitTests(Base):
    """3.1–4.2, C11, substantive change."""

    def test_review_needs_fill_draft_and_package(self):
        self.ready()
        errors = gate(self.w.book, 'b1', 'review', U1)['错误']
        for needle in ('填写读回', '草稿读回', '审核包.md 不存在'):
            self.assertTrue(has(errors, needle), needle)
        self.w.role_prepared(A, U1)
        self.assertTrue(gate(self.w.book, 'b1', 'review', U1)['允许'])

    def test_no_draft_site_is_allowed_with_explanation(self):
        self.ready(); folder = self.w.role_prepared(A, U1)
        (folder / '草稿读回.md').unlink()
        (folder / '无草稿说明.md').write_text('站点只有提交按钮\n', encoding='utf-8')
        self.assertTrue(gate(self.w.book, 'b1', 'review', U1)['允许'])

    def test_submit_needs_approval_target_and_recheck(self):
        self.ready(); self.w.role_prepared(A, U1)
        errors = gate(self.w.book, 'b1', 'submit', U1)['错误']
        for needle in ('批准.md 不存在', '目标确认.md 不存在', '提交前复核.md 不存在'):
            self.assertTrue(has(errors, needle), needle)
        self.w.role_approved(A, U1)
        result = gate(self.w.book, 'b1', 'submit', U1)
        self.assertTrue(result['允许'], result['错误'])
        self.assertIn('提交通行证', result)

    def test_substantive_change_after_approval_voids_it(self):
        self.ready(); folder = self.w.role_prepared(A, U1); self.w.role_approved(A, U1)
        (folder / '审核包.md').write_text('# 审核包\n关键回答: 改过了\n', encoding='utf-8')
        self.assertTrue(has(gate(self.w.book, 'b1', 'submit', U1)['错误'], '引用的不是当前审核包'))

    def test_target_must_match_tracker_row(self):
        self.ready(); self.w.role_prepared(A, U1); self.w.role_approved(A, U1, title='另一个岗位', bu='别的BU', city='上海')
        errors = gate(self.w.book, 'b1', 'submit', U1)['错误']
        for needle in ('目标确认的岗位', '目标确认的 BU', '目标确认的办公地'):
            self.assertTrue(has(errors, needle), needle)

    def test_site_limit(self):
        self.submitted(); self.w.company_ready(A, limit=1)
        self.w.add_role(A, U2); self.w.role_ready(A, U2); self.w.role_prepared(A, U2); self.w.role_approved(A, U2)
        self.assertTrue(has(gate(self.w.book, 'b1', 'submit', U2)['错误'], '超过官方上限 1'))

    def test_c11_unverified_rule_first_target_only(self):
        self.submitted(); self.w.company_ready(A, state='未核实')
        self.w.add_role(A, U2); self.w.role_ready(A, U2); self.w.role_prepared(A, U2); self.w.role_approved(A, U2)
        self.assertTrue(has(gate(self.w.book, 'b1', 'submit', U2)['错误'], '首次提交后读回'))
        self.w.write('投递证据/b1/公司/合成公司A/首次提交后读回.md', '账号状态: 已投 1 个\n')
        self.assertTrue(gate(self.w.book, 'b1', 'submit', U2)['允许'])


class CountingTests(Base):
    """C7 / 1.6: keep_gap counts scanned no-role companies as kept gaps; replace asks for replacements."""

    def test_replace_vs_keep_gap(self):
        self.submitted(); self.w.tag(B, '无法访问校招页面', '10-13 批次：页面无法访问')
        report = self.batch().report()
        self.assertEqual(report['剩余目标'], {'大厂': 0, '银行': 1})
        self.assertEqual(report['需补位公司'], {'银行': 1})
        self.w.write_query('大厂=1, 银行=1', '留空', '有合格岗位的公司')
        report = self.batch().report()
        self.assertEqual(report['剩余目标'], {'大厂': 0, '银行': 0})
        self.assertEqual(report['留空公司'], {'银行': 1})


class BlockedAndCloseoutTests(Base):
    """B10, 6.3–6.5, 5.5."""

    def test_blocked_needs_reason_owner_next_step_not_agent(self):
        self.ready()
        self.w.write('投递证据/b1/岗位/%s/受阻.md' % self.w.role_folder(A, U1).name, '原因: 证件号需本人填写\n解除方: Agent\n')
        errors = self.errors()
        self.assertTrue(has(errors, '下一步'))
        self.assertTrue(has(errors, 'Agent 能做的事是待办'))

    def test_closeout_requires_tags_finished_roles_and_stop_record(self):
        self.ready()
        result = gate(self.w.book, 'b1', 'closeout')
        reasons = result['收尾']['原因']
        self.assertFalse(result['允许'])
        self.assertTrue(has(reasons, '合成公司B 盘点状态是「尚未推进」'))
        self.assertTrue(has(reasons, '已开始但未提交也未记录受阻'))
        self.assertTrue(has(reasons, '保留页面'))

    def test_closeout_passes_when_everything_is_booked(self):
        self.submitted(); self.w.tag(B, '无用户要求岗位', '10-13 批次：无 AI 产品岗')
        self.w.write_query('大厂=1, 银行=1', '留空', '有合格岗位的公司')
        self.w.closeout_file()
        result = gate(self.w.book, 'b1', 'closeout')
        self.assertTrue(result['允许'], result)

    def test_waiting_for_user_is_a_user_block(self):
        self.ready(); self.w.role_prepared(A, U1)
        self.w.write('投递证据/b1/岗位/%s/受阻.md' % self.w.role_folder(A, U1).name, '原因: 等待批准\n解除方: 用户\n下一步: 用户批准后提交\n')
        self.w.tag(B, '无当年校招计划'); self.w.closeout_file()
        self.assertTrue(gate(self.w.book, 'b1', 'closeout')['允许'])

    def test_uncertain_result_blocks_closeout(self):
        self.ready(); self.w.role_prepared(A, U1)
        (self.w.role_folder(A, U1) / '结果不确定.md').write_text('点击后页面超时\n', encoding='utf-8')
        self.w.tag(B, '无当年校招计划'); self.w.closeout_file()
        self.assertTrue(has(gate(self.w.book, 'b1', 'closeout')['收尾']['原因'], '结果不确定'))


class PrimitiveTests(unittest.TestCase):
    def test_canonical_url_drops_tracking_only(self):
        self.assertEqual(canonical_url('HTTPS://Ex.test/j?id=1&utm_source=x&ref=y&bu=2'), 'https://ex.test/j?bu=2&id=1')
        self.assertEqual(canonical_url('not a url'), '')

    def test_parse_and_items(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t, 'x.md')
            p.write_text('批次：b1\n## 公司清单\n- 甲 | 大厂\n- 乙\n依据: 投递证据/x.md\n```\n键: 代码块里不算\n```\n', encoding='utf-8')
            kv, lines = parse(p)
            self.assertEqual(value(kv, '批次'), 'b1')
            self.assertEqual(list_items(lines['公司清单']), [['甲', '大厂'], ['乙']])
            self.assertEqual(value(kv, '键'), '')

    def test_ref_exists_stays_inside_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / '投递证据').mkdir(); (Path(t) / '投递证据' / 'a.md').write_text('x', encoding='utf-8')
            (Path(t) / 'b.md').write_text('x', encoding='utf-8')
            self.assertTrue(ref_exists(t, '投递证据/a.md'))
            self.assertTrue(ref_exists(t, '投递证据\\a.md'))
            for bad in ('b.md', '../b.md', '/etc/passwd', 'C:/x.md', '投递证据/missing.md', ''):
                self.assertFalse(ref_exists(t, bad), bad)

    def test_sample_workbook_reads(self):
        book = Workbook(HERE / 'fixtures' / 'sample_tracker.xlsx')
        self.assertEqual(book.problems, [])
        self.assertIn('中国大陆', book.role_sheets)
        self.assertGreater(len(book.placeholders), 100)


class CliTests(Base):
    def test_cli_exit_codes_and_where(self):
        py = sys.executable
        ok = subprocess.run([py, str(HERE / 'batch_check.py'), '--workbook', str(self.w.book), '--batch', 'b1'], capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        where = subprocess.run([py, str(HERE / 'batch_check.py'), '--workbook', str(self.w.book), '--batch', 'b1', '--where', '--company', A, '--url', U1],
                               capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertIn('岗位目录', json.loads(where.stdout))
        closeout = subprocess.run([py, str(HERE / 'stage_gate.py'), '--workbook', str(self.w.book), '--batch', 'b1', '--stage', 'closeout'],
                                  capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertEqual(closeout.returncode, 1)
        bad = Path(self.tmp.name, 'bad.xlsx'); bad.write_text('not excel', encoding='utf-8')
        broken = subprocess.run([py, str(HERE / 'stage_gate.py'), '--workbook', str(bad), '--batch', 'b1', '--stage', 'query'],
                                capture_output=True, text=True, encoding='utf-8', env=ENV)
        self.assertEqual(broken.returncode, 2)


class ParallelTests(Base):
    """Parallel sub-skill: 并行分工.md replaces the JSON manifest."""

    def run_check(self, text):
        path = self.w.write('投递证据/b1/并行分工.md', text)
        sys.path.insert(0, str(HERE.parent / 'skills' / 'application-parallel-execution' / 'scripts'))
        from validate_assignments import validate
        return validate(path)

    def manifest(self, rows, handoff=''):
        return ('批次: b1\n执行方式: 多个AI\n执行渠道: 平台子代理\n协调者: c\n分工版本: 1\n依据: ' + self.w.say('split') +
                '\n\n## 分工\n| 公司 | 招聘主体 | 账号范围 | 负责人 | 输出目录 |\n|---|---|---|---|---|\n' + rows + handoff)

    def test_valid_and_exclusive_ownership(self):
        ok = '| 合成公司A | 主体A | ATS-A | a1 | 投递证据/b1/输出/a1/A |\n| 合成公司B | 主体B | ATS-B | a2 | 投递证据/b1/输出/a2/B |\n'
        self.assertEqual(self.run_check(self.manifest(ok)), [])
        dup = ok + '| 合成公司C | 主体C | ATS-A | a2 | 投递证据/b1/输出/a2/C |\n'
        self.assertTrue(has(self.run_check(self.manifest(dup)), '账号范围」ATS-A 分给了不止一个负责人'))
        outside = '| 合成公司A | 主体A | ATS-A | a1 | 投递证据/b1/输出/a2/A |\n| 合成公司B | 主体B | ATS-B | a2 | 投递证据/b1/输出/a2/B |\n'
        self.assertTrue(has(self.run_check(self.manifest(outside)), '输出目录必须在'))

    def test_handoff_needs_stop_and_ack(self):
        rows = '| 合成公司A | 主体A | ATS-A | a2 | 投递证据/b1/输出/a2/A |\n| 合成公司B | 主体B | ATS-B | a1 | 投递证据/b1/输出/a1/B |\n'
        handoff = '\n## 交接\n| 公司 | 原负责人 | 新负责人 | 停止证据 | 接收证据 |\n|---|---|---|---|---|\n| 合成公司A | a1 | a2 | 无 | 无 |\n'
        self.assertTrue(has(self.run_check(self.manifest(rows, handoff)), '停止证据'))


if __name__ == '__main__':
    unittest.main()
