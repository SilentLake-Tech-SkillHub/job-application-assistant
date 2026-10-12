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
            for p in ROOT.rglob('*.md') if 'reports/' not in p.relative_to(ROOT).as_posix()}


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
        self.assertIn('Query', terms); self.assertIn('terms_mode', terms)
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
        self.assertIn('门禁通行证.json', contract)
        self.assertNotIn('--evidence-root', contract + read('references/daily-batch.md') + read('README.md'))
        hooks = read('hooks/README.md')
        for platform in ['Claude Code', 'Codex', 'Kimi Code', 'Z.ai', 'ZCode']:
            self.assertIn(platform, hooks)
        self.assertIn('投递证据/', read('SKILL.md'))

    def test_versions_bumped(self):
        self.assertIn('version: "1.13.0"', read('SKILL.md'))


if __name__ == '__main__':
    unittest.main()
