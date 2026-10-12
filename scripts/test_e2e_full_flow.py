#!/usr/bin/env python3
"""Full-flow test: one complete batch, Query → Prepare → Review → Submit → Resume → Closeout.

Runs against the synthetic recruiting site in fixtures/synthetic_ats.py with a real headless
browser (in-app lane), real stage gates in strict evidence mode (every reference is a file under
投递证据/ in the application root, user answers included), the PreToolUse submit guard, and a real
.xlsx tracker readback. User decisions are simulated and recorded as the user's answers; no real
site, account or personal data is involved. A pass here proves the Skill's procedure and tooling
fit together end to end, not that any live ATS behaves the same way.

  python3 test_e2e_full_flow.py [output_dir]
"""
import copy
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook, load_workbook
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'fixtures'))
from synthetic_ats import serve  # noqa: E402
from preference_contract import identity  # noqa: E402
from ledger_checks import review_hash_of  # noqa: E402
from stage_gate import run as gate  # noqa: E402
from tracker_readback import check as tracker_check  # noqa: E402

COMPANY = 'synthetic-ats'
NOW = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')  # noqa: E731


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FullFlow(unittest.TestCase):
    """One ordered scenario; each step asserts the gate decision the Skill requires."""

    @classmethod
    def setUpClass(cls):
        cls.out = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else None
        cls.tmp = tempfile.TemporaryDirectory()
        cls.ws = Path(cls.tmp.name)
        cls.evidence = cls.ws / '投递证据' / 'e2e-batch'
        cls.evidence.mkdir(parents=True)
        cls.base, cls.site, cls.server = serve()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('CHROME_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(headless=True, executable_path=exe or None)
        cls.page = cls.browser.new_page(viewport={'width': 1000, 'height': 900})
        cls.log = []

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown()
        if cls.out:
            cls.out.mkdir(parents=True, exist_ok=True)
            shutil.copytree(cls.ws / '投递证据', cls.out / '投递证据', dirs_exist_ok=True)
            (cls.out / 'batch.json').write_text(json.dumps(cls.batch, ensure_ascii=False, indent=2), encoding='utf-8')
            (cls.out / 'flow-log.json').write_text(json.dumps(cls.log, ensure_ascii=False, indent=2), encoding='utf-8')
        cls.tmp.cleanup()

    # ------------------------------------------------------------ helpers
    def ev(self, name, payload=None, shot=False):
        path = self.evidence / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if shot:
            self.page.screenshot(path=str(path), full_page=True)
        else:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        return 'file:投递证据/e2e-batch/' + name

    def say(self, name, text):
        """A user answer is evidence too: keep the user's wording and time as a file."""
        return self.ev('确认记录/' + name + '.json', {'user_said': text, 'at': NOW()})

    def gate(self, stage, role=None, allowed=True):
        result = gate(self.batch, stage, role, self.ws, strict=True)
        self.log.append({'gate': stage, 'role': role, 'allowed': result['allowed'], 'errors': result['errors'][:5]})
        self.batch['batch'].setdefault('gate_runs', []).append({'stage': stage, 'role': role, 'allowed': result['allowed'], 'at': NOW()})
        self.assertEqual(result['allowed'], allowed, json.dumps(result, ensure_ascii=False, indent=1))
        return result

    def ledger_path(self):
        path = self.ws / '投递证据' / 'e2e-batch' / 'batch.json'
        path.write_text(json.dumps(self.batch, ensure_ascii=False, indent=2), encoding='utf-8')
        return path

    def cli(self, script, *args):
        return subprocess.run([sys.executable, str(HERE / script), str(self.ledger_path()), *args], capture_output=True,
                              text=True, encoding='utf-8', env=dict(os.environ, PYTHONIOENCODING='utf-8'))

    def hook(self, tool_input, tool_name='mcp__Claude_Browser__computer'):
        """Call the PreToolUse guard exactly as Claude Code / Codex / Kimi would."""
        payload = json.dumps({'hook_event_name': 'PreToolUse', 'session_id': 'e2e', 'cwd': str(self.ws),
                              'tool_name': tool_name, 'tool_input': tool_input}, ensure_ascii=False)
        result = subprocess.run([sys.executable, str(HERE.parent / 'hooks' / 'application_guard.py')], input=payload.encode('utf-8'),
                                capture_output=True, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        self.log.append({'hook': tool_input.get('action_summary'), 'exit': result.returncode})
        return result.returncode

    def role(self, key):
        return next(r for r in self.batch['roles'] if r['role_key'] == key)

    def company(self):
        return self.batch['companies'][0]

    # ------------------------------------------------------------ the flow
    def test_full_flow(self):
        self.m1_query()
        self.m2_prepare()
        self.m3_review()
        self.m4_submit()
        self.m5_resume()
        self.m6_closeout()

    def m1_query(self):
        ws = self.ws
        resume = ws / 'synthetic-resume.pdf'; resume.write_bytes(b'%PDF-1.4 synthetic resume: degree=master\n')
        router = ws / 'ROUTER.md'; router.write_text('synthetic router', encoding='utf-8')
        profile = ws / 'profile.private.md'; profile.write_text('synthetic profile', encoding='utf-8')
        tracker = ws / 'tracker.xlsx'
        wb = Workbook(); sheet = wb.active; sheet.title = '岗位'
        sheet.append(['公司', '岗位', '岗位链接', 'JD', '状态'])
        sheet.append(['合成公司', '合成AI产品经理', self.base + '/jobs/101', '见私有台账', '待投递'])
        sheet.append(['合成公司', '合成数据产品经理', self.base + '/jobs/102', '见私有台账', '待投递'])
        wb.save(tracker)
        self.__class__.tracker = tracker
        prefs = {'version': 'p1', 'confirmation_ref': self.say('preferences', '不限城市、方向与用工'), 'effective_at': NOW(),
                 'supersedes_version': None, 'recheck_scope': [], 'hard_scope': {'cities': []},
                 'axes': {a: {'raw': 'synthetic: 不限', 'relations': []} for a in ('employment', 'city', 'direction')},
                 'internship_policy': 'excluded', 'default_role_order': 'AI 产品 > 数据产品',
                 'default_order_confirmation_ref': self.say('default-order', 'AI 产品优先，其次数据产品'), 'default_order_batch_id': 'e2e-batch',
                 'conflict_policy': 'user_decides'}
        sources = [{'name': n, 'ref': 'file:' + p.name, 'sha256': sha(p), 'read_at': NOW()}
                   for n, p in (('router', router), ('profile', profile), ('tracker', tracker), ('resume', resume))]
        sources.append({'name': 'batch_record', 'status': 'missing', 'handling': 'new batch created from this Query'})
        self.__class__.batch = {
            'batch': {'batch_id': 'e2e-batch', 'query_version': 'q1', 'preferences': prefs,
                      'quotas': {'all': None}, 'target_choice_ref': self.say('target', '覆盖确认清单即可，不设数字目标'),
                      'stop_condition': 'confirmed list covered', 'counting_basis': 'eligible', 'replacement_rule': 'keep_gap',
                      'bucket_rules_confirmed': True, 'scope_confirmed': True, 'materials_confirmed': True,
                      'preparation_authorized': True, 'role_selection_authorized': True, 'authorization_ref': self.say('authority', '可以在范围内选岗并准备表单'),
                      'entry': {'intent': 'application', 'basis': 'user: 准备并投递确认清单', 'ref': self.say('entry', '准备并投递确认清单里的岗位')},
                      'sources': sources,
                      'materials': [{'material_id': 'resume-v1', 'ref': 'file:' + resume.name, 'sha256': sha(resume)}],
                      'application_execution_mode': 'single', 'mode_approval_ref': self.say('mode', '一个 AI 执行'),
                      'channels': {'in_app': 'available', 'chrome': 'unavailable', 'computer_use': 'not_checked',
                                   'system_script': 'not_applicable', 'playwright': 'not_checked'},
                      'browser': {'playwright_substitute': {'approved': False, 'ref': self.say('playwright', '不用 Playwright')}}},
            'prior_roles': [],
            'companies': [{'company_key': COMPANY, 'bucket': 'all', 'state': 'unvisited'}],
            'roles': [],
        }
        # The automation answer is a "开始前必问" item: without it the Query gate blocks.
        self.gate('query', allowed=False)
        self.batch['batch']['automation'] = {
            'automation_mode': 'off', 'approved_subskills': [], 'approval_ref': self.say('automation', '不开启自动化子 Skill，条款逐项看'),
            'terms_mode': 'per_item', 'verification_mode': 'user_result', 'sms_read_allowed': False,
            'confirmation_refs': {'verification_takeover': [], 'wechat_handoff': [], 'terms_batch': []}}
        self.gate('query')

    def m2_prepare(self):
        page, base = self.page, self.base
        company = self.company()
        company.update(state='checking', browser_lane='in_app')
        page.goto(base + '/center')
        self.assertIn('/login', page.url)  # login handoff point reached
        # Browser-prefilled existing account: click ordinary 登录, never read the password value.
        page.get_by_role('button', name='登录').click()
        page.wait_for_url(base + '/center')
        account = page.locator('#account').inner_text()
        self.assertIn('synthetic-user', account)
        login_ref = self.ev('login/account.png', shot=True)
        rule_text = page.locator('#rule').inner_text()
        self.assertIn('最多投递 2 个岗位', rule_text)
        company['count_rule'] = {'status': 'verified', 'max_applications': 2, 'concurrent': True,
                                 'order_rule': '无志愿顺序', 'change_rule': '提交后不可修改志愿',
                                 'source': self.ev('rules/center-rule.json', {'text': rule_text, 'account': account}),
                                 'checked_at': NOW()}
        for job in ('101', '102'):
            page.goto(base + '/jobs/' + job)
            title, bu, city, jd = (page.locator(s).inner_text() for s in ('#title', '#bu', '#city', '#jd'))
            jd_ref = self.ev('jd/' + job + '.json', {'url': page.url, 'title': title, 'jd': jd})
            r = {'company_key': COMPANY, 'company': '合成公司', 'official_job_id': job, 'title': title,
                 'direct_url': page.url, 'bu': bu, 'cities': [city], 'employment_type': 'formal', 'direction': 'AI product',
                 'jd_full_text': jd, 'jd_capture_ref': jd_ref, 'jd_basis': jd.split('任职要求')[0],
                 'decision_reason': '职责为 AI/数据产品，符合确认范围', 'decision_basis': 'jd', 'hard_scope_pass': True,
                 'disposition': 'primary', 'preference_version': 'p1', 'stage': 'verified',
                 'pre_form_report_ref': 'file:投递证据/e2e-batch/reports/pre-form.json', 'report_precedes_form': True,
                 'execution': {a: {'status': 'not_started'} for a in ('fill', 'save', 'submit')}}
            r['role_key'] = identity(r)
            self.assertIn('必需：本科及以上', jd)  # eligibility: required degree vs. confirmed resume (master)
            r['eligibility'] = {'conclusion': 'meets', 'ref': self.ev('eligibility/' + job + '.json',
                                {'required': '本科及以上', 'evidence': 'resume-v1 degree=master', 'conclusion': 'meets'})}
            self.batch['roles'].append(r)
        company['state'] = 'checked'
        self.ev('reports/pre-form.json', [{k: r[k] for k in ('role_key', 'company', 'bu', 'cities', 'title', 'direct_url')}
                                          for r in self.batch['roles']])
        keys = [r['role_key'] for r in self.batch['roles']]
        self.__class__.keys = keys
        # Company order not yet confirmed: the prepare gate must block (company stays read-only).
        self.gate('prepare', keys[0], allowed=False)
        for r in self.batch['roles']:
            r.update(company_order_report_ref=r['pre_form_report_ref'], company_order_decision='unchanged',
                     company_order_confirmation_ref=self.say('company-order', '合成公司：次序不变'))
        for key, slot in zip(keys, ('合成智能事业群', '合成数据平台部')):
            self.gate('prepare', key)
            self.prepare_form(key, slot)
            r = self.role(key)
            r['stage'] = 'prepared'
            r['material_id'] = 'resume-v1'
            self.gate('review', key, allowed=False)  # no review package yet

    def prepare_form(self, key, slot):
        page, r = self.page, self.role(key)
        job = r['official_job_id']
        page.goto(self.base + '/apply/' + job)
        page.wait_for_selector('#save')
        page.add_script_tag(path=str(HERE / 'inspect_form_controls.js'))
        inventory = page.evaluate('inspectApplicationForm(document)')
        kinds = {c['kind'] for c in inventory['fields']}
        self.assertTrue({'file', 'select', 'checkbox'} <= kinds, kinds)
        self.ev('preflight/' + job + '.json', inventory)
        r['execution']['fill'] = {'status': 'in_progress', 'evidence_ref': 'file:投递证据/e2e-batch/preflight/' + job + '.json'}
        # Upload first: auto-parse re-renders the form with new ids and pollutes the name field.
        page.locator('input[type=file]').set_input_files(str(self.ws / 'synthetic-resume.pdf'))
        page.wait_for_function("document.querySelector('#resume-name').textContent.includes('synthetic-resume')")
        page.wait_for_timeout(150)
        self.assertEqual(page.get_by_label('姓名 *').input_value(), '合成解析错误名')
        page.add_script_tag(path=str(HERE / 'inspect_form_controls.js'))
        self.ev('preflight/' + job + '-after-parse.json', page.evaluate('inspectApplicationForm(document)'))
        page.get_by_label('姓名 *').fill('合成候选人')
        page.get_by_role('combobox', name='学历 *').click(); page.get_by_role('option', name='硕士').click()
        page.get_by_label('毕业时间 *').click(); page.get_by_role('button', name='2026-06').click()
        page.get_by_label('项目经历 *').fill('合成项目：负责 AI 产品需求、方案与迭代，指标提升 20%。')
        # Intention slot is a user-choice field: the user's choice is recorded, not the Agent's.
        page.get_by_label('第一意向部门 *').select_option(slot)
        r['selection_ref'] = self.say('slot-' + job, '第一意向：' + slot)
        # Terms with terms-consent off: handoff H6 — the user ticks it (simulated user action).
        page.get_by_label('我已阅读并同意《合成隐私条款》 *').check()
        r['handoffs'] = [{'point': 'H6 terms (subskill off)', 'by': 'user', 'at': NOW()}]
        page.get_by_role('button', name='保存草稿').click()
        page.wait_for_function("document.querySelector('#status').textContent==='草稿已保存'")
        fill = self.readback()
        r['execution']['fill'] = {'status': 'complete', 'evidence_ref': self.ev('fill/' + job + '.png', shot=True),
                                  'readback_ref': self.ev('fill/' + job + '-readback.json', fill)}
        # Reopen the server-saved draft and read every field back.
        page.goto(self.base + '/apply/' + job); page.wait_for_selector('#save')
        reopened = self.readback()
        self.assertEqual(reopened, fill)
        self.assertEqual(reopened['degree'], '硕士'); self.assertEqual(reopened['grad'], '2026-06')
        r['execution']['save'] = {'status': 'complete', 'evidence_ref': self.ev('save/' + job + '.json', {'status': '草稿已保存'}),
                                  'readback_ref': self.ev('save/' + job + '-reopened.json', reopened)}

    def readback(self):
        p = self.page
        return {'name': p.get_by_label('姓名 *').input_value(), 'degree': p.locator('.combo input').input_value(),
                'grad': p.get_by_label('毕业时间 *').input_value(), 'project': p.get_by_label('项目经历 *').input_value(),
                'slot1': p.get_by_label('第一意向部门 *').input_value(),
                'terms': p.get_by_label('我已阅读并同意《合成隐私条款》 *').is_checked(),
                'resume': p.locator('#resume-name').inner_text()}

    def m3_review(self):
        for key in self.keys:
            r = self.role(key)
            answers = json.loads((self.ws / r['execution']['save']['readback_ref'][5:]).read_text(encoding='utf-8'))
            package = {'materials': ['resume-v1'], 'consequential_answers': {k: answers[k] for k in ('degree', 'grad', 'slot1')},
                       'account_limit': '2 / 2 剩余', 'unresolved_fields': [], 'screenshots': [r['execution']['fill']['evidence_ref']]}
            r.update(review_package=package, review_hash=review_hash_of(package))
            self.gate('review', key)
            r['stage'] = 'reviewed'
            r.update(approved_review_hash=r['review_hash'], approval_ref=self.say('approve-' + r['official_job_id'], '批准 ' + r['title'] + ' 版本 ' + r['review_hash']))
        # Substantive change after approval: the old approval no longer applies.
        r = self.role(self.keys[0])
        saved = copy.deepcopy(r['review_package'])
        r['review_package']['consequential_answers']['slot1'] = '合成数据平台部'
        self.gate('submit', self.keys[0], allowed=False)
        r['review_package'] = saved

    def m4_submit(self):
        page = self.page
        for key in self.keys:
            r = self.role(key)
            self.gate('submit', key, allowed=False)  # target not yet confirmed by the user
            page.goto(self.base + '/center')
            history_before = page.locator('#history').inner_text()
            r['presubmit_check_ref'] = self.ev('presubmit/' + r['official_job_id'] + '.json',
                                               {'account': page.locator('#account').inner_text(), 'history': history_before,
                                                'review_hash': r['review_hash'], 'material': 'resume-v1'})
            slot = r['review_package']['consequential_answers']['slot1']
            r['target_confirmation'] = {'company': r['company'], 'bu': r['bu'], 'location': r['cities'][0], 'title': r['title'],
                                        'intent_slots': [slot], 'count_rule_line': '每账号最多 2 个，可同时进行；提交后不可改志愿',
                                        'review_hash': r['review_hash'], 'confirmation_ref': self.say('target-' + r['official_job_id'], '确认投递目标：' + r['title'] + ' / ' + slot)}
            click = {'action': 'left_click', 'action_summary': '点击“提交申请”'}
            self.assertEqual(self.hook(click), 2)  # no pass yet: the platform hook blocks the click
            gate_cli = self.cli('stage_gate.py', '--stage', 'submit', '--role', key)
            self.assertEqual(gate_cli.returncode, 0, gate_cli.stdout)
            self.assertIn('submit_pass', json.loads(gate_cli.stdout))
            self.log.append({'gate': 'submit (CLI, issues pass)', 'role': key, 'allowed': True, 'errors': []})
            page.goto(self.base + '/apply/' + r['official_job_id']); page.wait_for_selector('#submit')
            self.assertEqual(self.hook(click), 0)
            page.get_by_role('button', name='提交申请').click()
            modal = page.get_by_role('dialog', name='确认投递')
            self.assertIn(r['title'], modal.inner_text()); self.assertIn(slot, modal.inner_text())
            r['stage'] = 'submit_clicked'
            r['execution']['submit'] = {'status': 'in_progress', 'evidence_ref': self.ev('submit/' + r['official_job_id'] + '-modal.png', shot=True)}
            self.assertEqual(self.hook({'action': 'left_click', 'action_summary': '点击弹窗“确认投递”'}), 0)
            page.get_by_role('button', name='确认投递').click()
            page.wait_for_url('**/receipt/*')
            app_id = page.locator('#app-id').inner_text()
            receipt = self.ev('submit/' + r['official_job_id'] + '-receipt.png', shot=True)
            page.goto(self.base + '/center')
            self.assertIn(app_id, page.locator('#history').inner_text())  # verified in application history
            r.update(stage='submitted', receipt_ref=receipt)
            r['execution']['submit'] = {'status': 'complete', 'evidence_ref': receipt}
            self.ledger_path()  # persist after each role, as the Skill requires
            self.assertEqual(self.hook(click), 2)  # the used pass is void once the role is recorded submitted
            r['site_history_ref'] = self.ev('submit/' + r['official_job_id'] + '-history.json',
                                            {'application_id': app_id, 'history': page.locator('#history').inner_text()})
        # Tracker: reread, hash, back up, smallest update, then reopen and read back.
        tracker = self.tracker
        pre = sha(tracker); backup = tracker.with_suffix('.bak.xlsx'); shutil.copy(tracker, backup)
        wb = load_workbook(tracker); sheet = wb['岗位']
        urls = {self.role(k)['direct_url'] for k in self.keys}
        for row in sheet.iter_rows(min_row=2):
            if row[2].value in urls:
                row[4].value = '已投递'
        wb.save(tracker)
        expected = [{'key': self.role(k)['direct_url'], 'fields': {'状态': '已投递'}} for k in self.keys]
        self.assertEqual(tracker_check(tracker, backup, pre, '岗位', '岗位链接', expected), [])
        readback = self.ev('tracker/readback.json', {'pre_sha256': pre, 'post_sha256': sha(tracker), 'rows': expected})
        for k in self.keys:
            self.role(k).update(tracker_status='submitted', tracker_readback_ref=readback)

    def m5_resume(self):
        # New turn: reread site history, receipts, batch record and tracker, reconcile by precedence.
        self.page.goto(self.base + '/center')
        history = self.page.locator('#history').inner_text()
        wb = load_workbook(self.tracker, data_only=True)
        statuses = [row[4] for row in wb['岗位'].iter_rows(min_row=2, values_only=True)]
        conflicts = [] if len(self.site.history) == 2 and statuses == ['已投递', '已投递'] else ['mismatch']
        self.batch['batch']['resume_readback'] = {'ref': self.ev('resume/readback.json', {'history': history, 'tracker': statuses}),
                                                  'read_at': NOW(), 'conflicts': conflicts}
        self.assertEqual(conflicts, [])
        # A submitted role cannot pass the submit gate again (no duplicate application).
        self.gate('submit', self.keys[0], allowed=False)

    def m6_closeout(self):
        result = self.gate('closeout', allowed=False)  # null target: needs a recorded stop reason
        self.assertTrue(any('stop_reached_ref' in r for r in result['closeout']['reasons']))
        self.batch['batch']['stop_reached_ref'] = self.say('stop', '确认清单已全部覆盖，可以收尾')
        self.gate('closeout')
        path = self.ws / '投递证据' / 'e2e-batch' / 'batch.json'
        path.write_text(json.dumps(self.batch, ensure_ascii=False, indent=2), encoding='utf-8')
        cli = subprocess.run([sys.executable, str(HERE / 'validate_batch.py'), str(path), '--closeout'],
                             capture_output=True, text=True, encoding='utf-8', env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        out = json.loads(cli.stdout)
        self.assertEqual(cli.returncode, 0, cli.stdout)
        self.assertEqual(out['report']['verified_submissions'], 2)
        self.assertEqual(out['report']['prepared_applications'], 2)
        self.log.append({'final_report': out['report'], 'closeout': out['closeout']})


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])
