#!/usr/bin/env python3
"""Rule-text regression tests: each review conflict stays resolved in exactly one place."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def all_md():
    return {p.relative_to(ROOT).as_posix(): p.read_text(encoding='utf-8')
            for p in ROOT.rglob('*.md') if not {'reports', 'node_modules', '.git', 'test-results'}.intersection(p.relative_to(ROOT).parts)}


class ConflictTexts(unittest.TestCase):
    def test_c1_handoff_list_is_complete_and_single_sourced(self):
        contract = read('references/stage-contract.md')
        for n in range(1, 16):
            self.assertIn('| H' + str(n) + ' |', contract)
        for needle in ['次序确认', '审核版本批准', '名额不足', '资格待核', '跨轴冲突', '新法律协议', 'Playwright']:
            self.assertIn(needle, contract.split('## 5.')[1].split('## 6.')[0], needle)
        for path, text in all_md().items():
            self.assertNotIn('交接点只有以下几类', text, path)

    def test_c3_page_closing_has_one_rule(self):
        retention = read('references/browser-application.md').split('## Page retention')[1].split('\n## ')[0]
        self.assertIn('唯一规则', retention)
        self.assertIn('受保护页面', retention)
        self.assertIn('点名公司或页面', retention)
        grouping = read('references/chrome-window-grouping.md')
        self.assertNotIn('公司处理结束只清理', grouping)
        self.assertIn('browser-application.md#page-retention', grouping)

    def test_c8_entry_starts_from_confirmed_role_list(self):
        head = read('SKILL.md').split('\n---\n', 1)[0]
        self.assertIn('confirmed role list', head)
        self.assertNotIn('from official job discovery', head)
        self.assertIn('research workflow', head)

    def test_c4_terms_mode_asked_in_query(self):
        terms = read('skills/terms-consent/SKILL.md')
        self.assertTrue('Query' in terms and '条款方式:' in terms)
        self.assertNotIn('在首次遇到条款前，先问', terms)

    def test_c5_field_classification_table(self):
        privacy = read('skills/privacy-info-fill/SKILL.md')
        table = privacy.split('## 字段分类表')[1].split('## 信息来源分级')[0]
        self.assertRegex(table, r'姓名[^\n]*application-content-fill')
        self.assertRegex(table, r'期望薪资[^\n]*application-content-fill')
        self.assertRegex(table, r'手机号[^\n]*本子Skill')
        self.assertIn('字段分类表与-application-content-fill-的分界', read('skills/application-content-fill/SKILL.md'))

    def test_c6_profile_preferences_are_suggestions_only(self):
        self.assertIn('建议默认值', read('skills/personal-info-vault/SKILL.md'))
        self.assertIn('suggested default', read('SKILL.md'))

    def test_c9_company_confirmations_can_be_combined(self):
        skill = read('SKILL.md')
        self.assertIn('combined into one message', skill)
        self.assertIn('stays read-only', skill)

    def test_c10_query_timing_split(self):
        contract = read('references/stage-contract.md')
        self.assertIn('开始前必问', contract); self.assertIn('到步骤前再问', contract)
        self.assertIn('stage-contract.md#3-query开始前必问-vs-到步骤前再问', read('references/daily-batch.md'))
        self.assertNotIn('Ask only the decisions that affect the next action', read('references/daily-batch.md'))

    def test_c11_unverified_rule_first_target_only(self):
        self.assertIn('**only the first** target', read('SKILL.md'))
        self.assertIn('只确认第一个目标', read('references/automation-continuity.md'))

    def test_c12_receipts_not_blocked_by_order_confirmation(self):
        self.assertIn('已有官方回执的提交入账不受此限', read('references/preference-contract.md'))

    def test_c13_windows_otp_path(self):
        otp = read('skills/login-phone-otp/SKILL.md')
        self.assertIn('Windows', otp); self.assertIn('默认由用户提供或本人输入验证码', otp)

    def test_c14_email_applications_out_of_scope(self):
        self.assertIn('Email applications are out of scope', read('references/browser-application.md'))
        self.assertIn('不代发求职邮件', read('references/stage-contract.md'))

    def test_c15_draft_saving_single_rule(self):
        self.assertIn('Draft-saving timing (single rule)', read('references/browser-application.md'))
        self.assertNotIn('有保存按钮的站点每完成一个栏目就保存', read('references/automation-continuity.md'))

    def test_c16_search_concepts_isolated(self):
        contract = read('references/preference-contract.md')
        section = contract.split('## 与搜索流程的交接字段')[1].split('\n## ')[0]
        self.assertIn('Top5', section)
        self.assertEqual(contract.count('Top5'), section.count('Top5'))

    def test_c2_lane_recovery_not_free_switching(self):
        login = read('skills/application-login/SKILL.md')
        self.assertNotIn('普通控件不可达时可切换受支持通道，但', login)
        self.assertIn('换通道是交接', login)


class StructureTexts(unittest.TestCase):
    def test_duplicated_order_paragraph_removed(self):
        dup = '不另建三套脱节清单'
        hits = [p for p, t in all_md().items() if dup in t]
        self.assertEqual(hits, [], hits)

    def test_skill_modes_are_numbered_consecutively(self):
        modes = read('SKILL.md').split('## Modes and authority')[1].split('\n## ')[0]
        numbers = [int(n) for n in re.findall(r'^(\d)\. \*\*', modes, re.M)]
        self.assertEqual(numbers, [1, 2, 3, 4, 5])

    def test_gate_commands_documented_where_used(self):
        skill = read('SKILL.md')
        for stage in ['query', 'prepare', 'review', 'submit', 'closeout']:
            self.assertIn('--stage ' + stage, skill + read('references/stage-contract.md'), stage)

    def test_strict_evidence_and_hook_documented(self):
        contract = read('references/stage-contract.md')
        self.assertIn('## 10a. 严格证据模式与 `投递证据/`', contract)
        self.assertTrue('门禁通行证.md' in contract)
        self.assertFalse('--evidence-root' in contract + read('references/daily-batch.md') + read('README.md'))
        hooks = read('hooks/README.md')
        for platform in ['Claude Code', 'Codex', 'Kimi Code', 'Z.ai', 'ZCode']:
            self.assertIn(platform, hooks)
        self.assertIn('投递证据/', read('SKILL.md'))

    def test_issue25_tracker_is_the_only_state_record(self):
        contract = read('references/workbook-contract.md')
        for needle in ('workbook-schema.md', 'research-progress.md', '只要扫过', '唯一的状态记录'):
            self.assertTrue(needle in contract, needle)
        for label in ('已有相关岗位记录', '无当年校招计划', '无用户要求岗位', '无法访问校招页面', '尚未推进', '待投递', '已提交'):
            self.assertTrue(label in contract, label)
        skill = read('SKILL.md')
        self.assertTrue('盘点状态' in skill and 'there is no JSON ledger' in skill)
        for path, text in all_md().items():
            for stale in ('private batch record', 'batch ledger', 'validate_batch.py', 'preference_contract.py', '<batch.json>', 'batch.json'):
                self.assertFalse(stale in text, (path, stale))
        self.assertFalse(list(ROOT.glob('scripts/*ledger*')) or list(ROOT.glob('scripts/validate_batch.py')))

    def test_issue27_playwright_is_standing_backup(self):
        lanes = read('references/browser-application.md').split('## 浏览器分工')[1].split('## 批量填写')[0]
        self.assertIn('常备备用', lanes)
        self.assertIn('不再每批询问是否同意', lanes)
        self.assertIn('由用户自己调整环境', lanes)
        for path, text in all_md().items():
            for stale in ('Playwright代替', '代替 Chrome 通道吗', '同意才启用 Playwright', '不为凑齐通道而安装依赖', '明确同意才启用并记录'):
                self.assertFalse(stale in text, (path, stale))
        self.assertIn('Playwright is the standing backup', read('SKILL.md'))

    def test_issue27_fill_cache_and_excel_division(self):
        contract = read('references/workbook-contract.md')
        section = contract.split('## 填写缓存与 Excel 的分工')[1].split('\n## ')[0]
        for needle in ('唯一的状态记录', '两边互不代写', '提交已点击.md', '当场**改 `已提交`', '方案哈希', '删掉 JSON'):
            self.assertIn(needle, section)
        fill = read('references/browser-application.md').split('## 批量填写与填写缓存')[1].split('\n## ')[0]
        for needle in ('form_input', 'playwright_fill.py', '仍然禁止', '派发合成事件', '值来源: 档案', '续跑时先看', '复核'):
            self.assertIn(needle, fill)
        self.assertIn('填写方案.json', read('references/control-preflight.md'))
        self.assertNotIn('不要先把所有input一律赋值', read('references/control-preflight.md'))

    def test_issue27_interruption_rules(self):
        contract = read('references/stage-contract.md')
        resume = contract.split('### 7a.')[1].split('\n## ')[0]
        for needle in ('提交已点击.md', '不再发提交通行证', '24 小时', '7 天', '填写进度'):
            self.assertIn(needle, resume)
        self.assertIn('提交已点击.md', read('hooks/README.md'))
        self.assertIn('提交已点击.md', read('references/daily-batch.md'))

    def test_profile_from_resume_and_write_back(self):
        vault = read('skills/personal-info-vault/SKILL.md')
        for needle in ('profile_vault.py init', '简历文本.md', '省 token', 'profile_vault.py add', 'vault-sync', '不覆盖'):
            self.assertIn(needle, vault)
        template = read('skills/personal-info-vault/assets/profile-template.md')
        for needle in ('## 简历基础信息', '简历哈希:', '## 网申补充信息', '| 手机号 |', '| 邮箱 |'):
            self.assertIn(needle, template)
        self.assertIn('profile_vault.py add', read('skills/privacy-info-fill/SKILL.md'))

    def test_codex_submit_protections_documented(self):
        contract = read('references/stage-contract.md')
        for needle in ('提交核查.md', '只放行一次首次提交', '加锁', '新批次'):
            self.assertIn(needle, contract)
        fill = read('references/browser-application.md').split('## 批量填写与填写缓存')[1].split('\n## ')[0]
        for needle in ('page-check', '15 分钟', 'privacy-info-fill', '--workbook', '逐字输入'):
            self.assertIn(needle, fill)

    def test_versions_bumped(self):
        self.assertTrue('version: "1.17.0"' in read('SKILL.md'))


if __name__ == '__main__':
    unittest.main()
