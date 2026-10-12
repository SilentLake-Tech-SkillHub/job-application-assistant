#!/usr/bin/env python3
"""One test (or more) per review item fixed in v1.13. Synthetic data only."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from validate_batch import validate
from ledger_checks import review_hash_of, evidence_errors, closeout_status
from stage_gate import run as gate
from test_validate_batch import fixture, make_reviewed, make_submit_ready, H

HERE = Path(__file__).resolve().parent


def started(r, status='in_progress'):
    r['execution']['fill'] = {'status': status, 'evidence_ref': 'synthetic-fill'}
    return r


def prepared(r):
    r.update(stage='prepared', material_id='sample-resume')
    r['execution']['fill'] = {'status': 'complete', 'evidence_ref': 'synthetic-fill', 'readback_ref': 'synthetic-fill-readback'}
    r['execution']['save'] = {'status': 'complete', 'evidence_ref': 'synthetic-draft', 'readback_ref': 'synthetic-reopened'}
    return r


def second_role(data, job='2'):
    r = copy.deepcopy(data['roles'][0])
    r.update(official_job_id=job, role_key='alpha:id:' + job, direct_url='https://example.test/a/' + job)
    data['roles'].append(r)
    return r


def has(errors, needle):
    return any(needle in e for e in errors)


class QueryRecordTests(unittest.TestCase):
    """Review items 1.1, 1.2, 1.7, 1.8, 1.9, 1.10 and C10 (Query must-ask items are recorded)."""

    def test_fixture_is_valid(self):
        errors, _ = validate(fixture())
        self.assertEqual(errors, [])

    def test_1_1_research_request_is_not_an_application_batch(self):
        data = fixture(); data['batch']['entry']['intent'] = 'research'
        self.assertTrue(has(validate(data)[0], 'batch.entry'))

    def test_1_2_sources_need_hash_or_missing_handling(self):
        data = fixture(); data['batch']['sources'][2] = {'name': 'tracker', 'ref': 'synthetic-tracker'}
        self.assertTrue(has(validate(data)[0], 'source tracker needs ref, sha256'))
        data['batch']['sources'][2] = {'name': 'tracker', 'status': 'missing'}
        self.assertTrue(has(validate(data)[0], 'missing source tracker needs its handling'))
        data['batch']['sources'][2]['handling'] = 'asked the user for the tracker location'
        self.assertEqual(validate(data)[0], [])
        data['batch']['sources'] = [s for s in data['batch']['sources'] if s['name'] != 'resume']
        self.assertTrue(has(validate(data)[0], 'confirmed résumé'))

    def test_1_7_material_identity_must_be_a_hashed_batch_material(self):
        data = fixture(); data['batch']['materials'][0]['sha256'] = 'abc'
        self.assertTrue(has(validate(data)[0], 'material_id, ref and sha256'))
        data = fixture(); r = prepared(data['roles'][0]); r['material_id'] = 'old-resume'
        self.assertTrue(has(validate(data)[0], 'not a confirmed batch material'))

    def test_1_7_role_selection_authority_is_recorded(self):
        data = fixture(); data['batch'].pop('role_selection_authorized')
        self.assertTrue(has(validate(data)[0], 'role_selection_authorized'))
        data = fixture(); data['batch']['role_selection_authorized'] = False
        started(data['roles'][0])
        self.assertTrue(has(validate(data)[0], 'without role-selection authority'))
        data['roles'][0]['selection_ref'] = 'synthetic-user-picked-this-role'
        self.assertEqual(validate(data)[0], [])

    def test_1_8_application_execution_mode_is_required(self):
        data = fixture(); data['batch']['application_execution_mode'] = None
        self.assertTrue(has(validate(data)[0], 'application_execution_mode'))

    def test_1_9_automation_record_is_consistent(self):
        cases = [
            ({'automation_mode': 'off', 'approved_subskills': ['captcha-solve']}, 'automation off cannot approve'),
            ({'automation_mode': 'full', 'approved_subskills': ['captcha-solve']}, 'full enables all five'),
            ({'automation_mode': 'semi', 'approved_subskills': []}, 'semi must name'),
            ({'automation_mode': 'semi', 'approved_subskills': ['terms-consent'], 'terms_mode': None}, 'terms_mode must be asked in Query'),
            ({'automation_mode': 'semi', 'approved_subskills': ['terms-consent'], 'terms_mode': 'current_workflow_all'}, 'three distinct confirmation refs'),
            ({'sms_read_allowed': True}, 'sms_read_allowed requires'),
            ({'automation_mode': 'semi', 'approved_subskills': ['nonexistent']}, 'distinct known subskills'),
        ]
        for patch, needle in cases:
            data = fixture(); data['batch']['automation'].update(patch)
            self.assertTrue(has(validate(data)[0], needle), needle)
        data = fixture(); a = data['batch']['automation']
        a.update(automation_mode='full', approved_subskills=['login-phone-otp', 'login-wechat', 'captcha-solve', 'privacy-info-fill', 'terms-consent'],
                 approval_ref='synthetic-full', terms_mode='current_workflow_all')
        a['confirmation_refs']['terms_batch'] = ['c1', 'c2', 'c3']
        self.assertEqual(validate(data)[0], [])
        a['confirmation_refs']['terms_batch'] = ['c1', 'c1', 'c1']
        self.assertTrue(has(validate(data)[0], 'three distinct'))

    def test_1_10_channel_preflight_is_recorded(self):
        data = fixture(); data['batch']['channels'].pop('chrome')
        self.assertTrue(has(validate(data)[0], 'batch.channels'))


class LaneTests(unittest.TestCase):
    """Review items 2.1 and C2 (one lane per company; Playwright only as an approved substitute)."""

    def test_lane_required_before_forms(self):
        data = fixture(); data['companies'][0].pop('browser_lane'); started(data['roles'][0])
        self.assertTrue(has(validate(data)[0], 'needs browser_lane'))

    def test_playwright_needs_approved_substitute(self):
        data = fixture(); data['companies'][0]['browser_lane'] = 'playwright'
        self.assertTrue(has(validate(data)[0], 'without an approved substitute'))
        data['batch']['browser']['playwright_substitute'] = {'approved': True, 'ref': 'synthetic-yes-playwright'}
        self.assertEqual(validate(data)[0], [])

    def test_lane_change_is_a_recorded_handoff(self):
        data = fixture(); data['companies'][0]['lane_history'] = [{'from': 'chrome', 'to': 'in_app'}]
        self.assertTrue(has(validate(data)[0], 'handoff_ref'))


class EligibilityTests(unittest.TestCase):
    """Review item 2.3 (pending/not-met roles cannot enter forms without a specific user instruction)."""

    def test_eligibility_required_and_pending_blocks_forms(self):
        data = fixture(); r = started(data['roles'][0]); r.pop('eligibility')
        self.assertTrue(has(validate(data)[0], 'eligibility conclusion'))
        r['eligibility'] = {'conclusion': 'pending', 'ref': 'synthetic-elig'}
        self.assertTrue(has(validate(data)[0], 'specific attempt instruction'))
        r['eligibility']['user_attempt_ref'] = 'synthetic-user-try-anyway'
        self.assertEqual(validate(data)[0], [])


class CountRuleTests(unittest.TestCase):
    """Review item 2.6, Issue #12 and C11."""

    def test_count_rule_required_before_forms(self):
        data = fixture(); data['companies'][0].pop('count_rule'); started(data['roles'][0])
        self.assertTrue(has(validate(data)[0], 'needs count_rule'))

    def test_verified_rule_needs_limit_and_source(self):
        data = fixture(); started(data['roles'][0]); data['companies'][0]['count_rule'].update(max_applications=None, source='')
        errors = validate(data)[0]
        self.assertTrue(has(errors, 'needs max_applications')); self.assertTrue(has(errors, 'needs source'))

    def test_more_prepared_roles_than_limit_needs_user_choice(self):
        data = fixture(); data['companies'][0]['count_rule']['max_applications'] = 1
        prepared(data['roles'][0]); prepared(second_role(data))
        self.assertTrue(has(validate(data)[0], 'count_choice_ref'))
        data['companies'][0]['count_choice_ref'] = 'synthetic-user-chose-role-1'
        self.assertEqual(validate(data)[0], [])

    def test_submissions_cannot_exceed_site_limit(self):
        data = fixture(); data['companies'][0]['count_rule']['max_applications'] = 1
        data['companies'][0]['prior_submitted_count'] = 1
        data['companies'][0]['count_choice_ref'] = 'synthetic'
        r = prepared(data['roles'][0]); r['stage'] = 'reviewed'; make_submit_ready(r); r['stage'] = 'submit_clicked'
        self.assertTrue(has(validate(data)[0], 'exceeds the site application limit'))

    def test_c11_unverified_rule_confirms_only_first_target(self):
        data = fixture(); data['companies'][0]['count_rule'] = {'status': '未核实', 'max_applications': None}
        for r in (data['roles'][0], second_role(data)):
            prepared(r); r['stage'] = 'reviewed'; make_submit_ready(r)
        self.assertTrue(has(validate(data)[0], 'confirm/submit only the first target'))
        data['companies'][0]['first_submit_readback_ref'] = 'synthetic-account-history-after-first'
        self.assertEqual(validate(data)[0], [])


class ReviewAndSubmitTests(unittest.TestCase):
    """Review items 3.1, 3.3, 4.1, 4.2 and the 'substantive change' definition."""

    def reviewed(self):
        data = fixture(); r = prepared(data['roles'][0]); r['stage'] = 'reviewed'; make_reviewed(r)
        return data, r

    def test_3_1_review_package_contents_required(self):
        data, r = self.reviewed(); r['review_package'].pop('unresolved_fields')
        self.assertTrue(has(validate(data)[0], 'review_package must include'))

    def test_3_3_edit_after_review_is_detected(self):
        data, r = self.reviewed()
        self.assertEqual(validate(data)[0], [])
        r['review_package']['consequential_answers']['synthetic question'] = 'changed after review'
        self.assertTrue(has(validate(data)[0], 'changed after review_hash'))
        make_reviewed(r, 'changed after review')
        self.assertEqual(validate(data)[0], [])

    def test_4_1_and_4_2_presubmit_and_target_confirmation(self):
        data, r = self.reviewed(); make_submit_ready(r); r['stage'] = 'submit_clicked'
        self.assertEqual(validate(data)[0], [])
        for field, value, needle in [('presubmit_check_ref', '', 'presubmit_check_ref'),
                                     ('target_confirmation', None, 'needs target_confirmation')]:
            broken = copy.deepcopy(data); broken['roles'][0][field] = value
            self.assertTrue(has(validate(broken)[0], needle), needle)
        for field, value, needle in [('location', '别的城市', 'location must be one of'),
                                     ('title', '另一岗位', 'target_confirmation.title'),
                                     ('review_hash', 'sha256:old', 'another review version'),
                                     ('intent_slots', None, 'intent_slots'),
                                     ('confirmation_ref', '', 'confirmation_ref')]:
            broken = copy.deepcopy(data); broken['roles'][0]['target_confirmation'][field] = value
            self.assertTrue(has(validate(broken)[0], needle), needle)

    def test_4_6_tracker_status_needs_readback(self):
        data, r = self.reviewed(); make_submit_ready(r)
        r.update(stage='submitted', receipt_ref='synthetic-receipt', tracker_status='submitted')
        r['execution']['submit'] = {'status': 'complete', 'evidence_ref': 'synthetic-receipt'}
        self.assertTrue(has(validate(data)[0], 'tracker_readback_ref'))
        r['tracker_readback_ref'] = 'synthetic-readback'
        self.assertEqual(validate(data)[0], [])


class CountingTests(unittest.TestCase):
    """Review item C7 / 1.6: replacement_rule changes the remaining target."""

    def test_keep_gap_counts_blocked_company_and_replace_does_not(self):
        data = fixture()  # beta (bank) is blocked, target bank: 1
        _, report = validate(data)
        self.assertEqual(report['remaining_quota']['bank'], 1)
        self.assertEqual(report['replacement_needed'], {'bank': 1})
        data['batch']['replacement_rule'] = 'keep_gap'
        _, report = validate(data)
        self.assertEqual(report['remaining_quota']['bank'], 0)
        self.assertEqual(report['kept_gaps'], {'bank': 1})
        self.assertEqual(report['replacement_needed'], {})

    def test_keep_gap_counts_role_free_company_on_eligible_basis(self):
        data = fixture(); data['roles'] = []
        data['batch']['replacement_rule'] = 'keep_gap'
        _, report = validate(data)
        self.assertEqual(report['remaining_quota']['large'], 0)
        self.assertEqual(report['kept_gaps'], {'large': 1, 'bank': 1})


class ResumeTests(unittest.TestCase):
    """Review items C12 and 5.1/5.2."""

    def test_c12_site_receipt_recorded_without_this_batch_order_confirmation(self):
        data = fixture(); r = prepared(data['roles'][0]); make_submit_ready(r)
        r.update(stage='submitted', receipt_ref='synthetic-receipt')
        r['execution']['submit'] = {'status': 'complete', 'evidence_ref': 'synthetic-receipt'}
        r.pop('company_order_confirmation_ref'); r.pop('eligibility')
        self.assertTrue(has(validate(data)[0], 'company order must be confirmed'))
        r['site_history_ref'] = 'synthetic-application-center-entry'
        self.assertEqual(validate(data)[0], [])

    def test_recovery_record_needs_ref_and_result(self):
        data = fixture(); data['roles'][0]['recovery'] = {'ref': 'synthetic'}
        self.assertTrue(has(validate(data)[0], 'recovery needs ref and result'))


class EvidenceTests(unittest.TestCase):
    """STRUCT 'evidence self-reported' and review item 2.11."""

    def test_file_refs_must_exist_inside_root(self):
        data = fixture(); r = prepared(data['roles'][0])
        r['execution']['fill']['readback_ref'] = 'file:readback/role1.json'
        r['execution']['save']['evidence_ref'] = 'file:../escape.png'
        with tempfile.TemporaryDirectory() as root:
            errors = evidence_errors(data, root, strict=False)
            self.assertTrue(has(errors, 'evidence file not found: readback/role1.json'))
            self.assertTrue(has(errors, 'outside the application root'))
            Path(root, 'readback').mkdir(); Path(root, 'readback', 'role1.json').write_text('{}', encoding='utf-8')
            r['execution']['save']['evidence_ref'] = 'file:draft.png'; Path(root, 'draft.png').write_bytes(b'x')
            self.assertEqual(evidence_errors(data, root, strict=False), [])


class CloseoutTests(unittest.TestCase):
    """Review items 6.3, 6.4, 5.5 (B10 second half): the batch cannot end with Agent work left."""

    def status(self, data):
        _, report = validate(data)
        return closeout_status(data, report)

    def test_cannot_close_with_agent_work_or_open_target(self):
        data = fixture()
        result = self.status(data)
        self.assertFalse(result['can_close'])
        self.assertTrue(has(result['reasons'], "role 'alpha:id:1' is verified"))
        self.assertTrue(has(result['reasons'], 'no stop_reached_ref'))

    def test_blocked_work_is_not_agent_work_and_stop_reason_closes(self):
        data = fixture(); r = data['roles'][0]
        r['execution']['fill'] = {'status': 'blocked', 'evidence_ref': 'synthetic', 'reason': 'user-only field',
                                  'unblock_owner': 'user', 'next_action': 'user fills it'}
        data['batch']['stop_reached_ref'] = 'synthetic: user confirmed stopping today'
        self.assertEqual(self.status(data), {'can_close': True, 'reasons': []})

    def test_unreconciled_attempt_blocks_closeout(self):
        data = fixture(); r = prepared(data['roles'][0]); r['stage'] = 'uncertain'
        r['execution']['submit'] = {'status': 'uncertain', 'evidence_ref': 'synthetic'}
        data['batch']['stop_reached_ref'] = 'synthetic'
        self.assertTrue(has(self.status(data)['reasons'], 'unreconciled submission'))


class GateTests(unittest.TestCase):
    """Review item 1.11 / 1.3: gates simulate the next stage and block on any error."""

    def test_prepare_gate(self):
        data = fixture()
        self.assertTrue(gate(data, 'prepare', 'alpha:id:1')['allowed'])
        data['roles'][0]['eligibility'] = {'conclusion': 'not_meets', 'ref': 'synthetic'}
        result = gate(data, 'prepare', 'alpha:id:1')
        self.assertFalse(result['allowed']); self.assertTrue(has(result['errors'], 'attempt instruction'))
        self.assertFalse(gate(data, 'prepare', 'missing-role')['allowed'])

    def test_review_gate_needs_prepared_role_with_package(self):
        data = fixture()
        self.assertFalse(gate(data, 'review', 'alpha:id:1')['allowed'])
        r = prepared(data['roles'][0])
        self.assertTrue(has(gate(data, 'review', 'alpha:id:1')['errors'], 'review_package'))
        make_reviewed(r)
        self.assertTrue(gate(data, 'review', 'alpha:id:1')['allowed'])

    def test_submit_gate_needs_approval_and_target(self):
        data = fixture(); r = prepared(data['roles'][0]); r['stage'] = 'reviewed'; make_reviewed(r)
        result = gate(data, 'submit', 'alpha:id:1')
        self.assertFalse(result['allowed'])
        self.assertTrue(has(result['errors'], 'target_confirmation'))
        make_submit_ready(r)
        self.assertTrue(gate(data, 'submit', 'alpha:id:1')['allowed'])

    def test_query_gate_blocks_incomplete_query(self):
        data = fixture(); data['batch'].pop('automation')
        self.assertFalse(gate(data, 'query')['allowed'])

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'batch.json'); path.write_text(json.dumps(fixture(), ensure_ascii=False), encoding='utf-8')
            env = dict(os.environ, PYTHONIOENCODING='utf-8')
            ok = subprocess.run([sys.executable, str(HERE / 'stage_gate.py'), str(path), '--stage', 'prepare', '--role', 'alpha:id:1', '--lenient'],
                                capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            blocked = subprocess.run([sys.executable, str(HERE / 'stage_gate.py'), str(path), '--stage', 'closeout', '--lenient'],
                                     capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(blocked.returncode, 1)
            self.assertFalse(json.loads(blocked.stdout)['allowed'])
            bad = Path(tmp, 'bad.json'); bad.write_text('not json', encoding='utf-8')
            unreadable = subprocess.run([sys.executable, str(HERE / 'stage_gate.py'), str(bad), '--stage', 'query'],
                                        capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(unreadable.returncode, 2)


if __name__ == '__main__':
    unittest.main()
