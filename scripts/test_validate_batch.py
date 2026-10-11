#!/usr/bin/env python3
"""Behavioral checks for the portable batch-ledger validator."""

import copy
import unittest

from validate_batch import validate
from test_preference_contract import preferences, role


def fixture():
    return {
        "batch": {
            "batch_id": "sample-day",
            "query_version": "v1",
            "preferences": preferences("sample-day"),
            "quotas": {"large": 1, "bank": 1},
            "counting_basis": "eligible",
            "replacement_rule": "replace",
            "bucket_rules_confirmed": True,
            "scope_confirmed": True,
            "materials_confirmed": True,
            "preparation_authorized": True,
        },
        "prior_roles": [],
        "companies": [
            {"company_key": "alpha", "bucket": "large", "state": "checked"},
            {"company_key": "beta", "bucket": "bank", "state": "blocked", "blocked": {
                "reason": "synthetic site maintenance page", "scope": "company", "unblock_owner": "site",
                "next_action": "recheck after the announced window; continue other companies meanwhile",
                "evidence_ref": "synthetic-maintenance-capture"}},
        ],
        "roles": [
            dict(role(), role_key="alpha:id:1", company_key="alpha", direct_url="https://example.test/a/1"),
        ],
    }


class BatchValidationTests(unittest.TestCase):
    def test_counts_do_not_conflate_checked_eligible_prepared_or_submitted(self):
        errors, report = validate(fixture())
        self.assertEqual(errors, [])
        self.assertEqual(report["checked_companies"], {"large": 1})
        self.assertEqual(report["eligible_companies"], {"large": 1})
        self.assertEqual(report["eligible_roles"], 1)
        self.assertEqual(report["prepared_applications"], 0)
        self.assertEqual(report["verified_submissions"], 0)
        self.assertEqual(report["remaining_quota"], {"large": 0, "bank": 1})

    def test_duplicate_company_and_role_url_are_rejected(self):
        data = fixture()
        data["companies"].append({"company_key": "alpha", "bucket": "bank", "state": "checked"})
        data["roles"].append({"role_key": "a-2", "company_key": "alpha", "direct_url": "https://example.test/a/1", "stage": "verified"})
        errors, _ = validate(data)
        self.assertTrue(any("repeated company_key" in error for error in errors))
        self.assertTrue(any("repeated direct role URL" in error for error in errors))

    def test_role_free_company_count_depends_on_confirmed_basis(self):
        data = fixture()
        data["roles"] = []
        data["batch"]["counting_basis"] = "checked"
        _, report = validate(data)
        self.assertEqual(report["remaining_quota"]["large"], 0)
        data["batch"]["counting_basis"] = "eligible"
        _, report = validate(data)
        self.assertEqual(report["remaining_quota"]["large"], 1)

    def test_submission_requires_matching_approval_and_receipt(self):
        data = fixture()
        role = data["roles"][0]
        role.update(stage="submitted", material_id="sample-resume", review_hash="v2", approved_review_hash="v1", tracker_status="submitted")
        errors, _ = validate(data)
        self.assertTrue(any("lacks approval" in error for error in errors))
        self.assertTrue(any("official receipt" in error for error in errors))
        role["execution"]["fill"] = {"status": "complete", "evidence_ref": "synthetic-fill"}
        role["execution"]["submit"] = {"status": "complete", "evidence_ref": "receipt-1"}
        role.update(approved_review_hash="v2", approval_ref="user-message-1", receipt_ref="receipt-1")
        errors, report = validate(data)
        self.assertEqual(errors, [])
        self.assertEqual(report["verified_submissions"], 1)

    def test_uncertain_click_cannot_mark_tracker_submitted(self):
        data = copy.deepcopy(fixture())
        data["roles"][0].update(stage="submit_clicked", material_id="sample-resume", review_hash="v1", approved_review_hash="v1", approval_ref="user-message-1", tracker_status="submitted")
        errors, report = validate(data)
        self.assertTrue(any("without a verified stage" in error for error in errors))
        self.assertEqual(report["uncertain_roles"], 1)
        self.assertEqual(report["verified_submissions"], 0)

    def test_query_cannot_run_with_unconfirmed_bucket_rules(self):
        data = fixture()
        data["batch"]["bucket_rules_confirmed"] = False
        errors, _ = validate(data)
        self.assertTrue(any("bucket_rules_confirmed" in error for error in errors))

    def test_uncertain_pending_unstarted_is_rejected_and_not_prepared(self):
        data = fixture()
        data['roles'][0].update(stage='uncertain', disposition='pending', material_id='synthetic-resume')
        errors, report = validate(data)
        self.assertTrue(any('attempted-action evidence' in e for e in errors))
        self.assertEqual(report['prepared_applications'], 0)

    def test_uncertain_partially_filled_is_valid_but_not_prepared(self):
        data = fixture(); r = data['roles'][0]
        r.update(stage='uncertain', material_id='synthetic-resume')
        r['execution']['fill'] = {'status': 'in_progress', 'evidence_ref': 'synthetic-fill'}
        errors, report = validate(data)
        self.assertEqual(errors, [])
        self.assertEqual(report['prepared_applications'], 0)

    def test_uncertain_with_completed_fill_evidence_counts_as_prepared(self):
        data = fixture(); r = data['roles'][0]
        r.update(stage='uncertain', material_id='synthetic-resume')
        r['execution']['fill'] = {'status': 'complete', 'evidence_ref': 'synthetic-fill', 'readback_ref': 'synthetic-fill-readback'}
        r['execution']['save'] = {'status': 'complete', 'evidence_ref': 'synthetic-draft', 'readback_ref': 'synthetic-reopened-draft'}
        r['execution']['submit'] = {'status': 'uncertain', 'evidence_ref': 'synthetic-attempt'}
        errors, report = validate(data)
        self.assertEqual(errors, [])
        self.assertEqual(report['prepared_applications'], 1)
        self.assertEqual(report['verified_submissions'], 0)

    def test_batch_default_order_cannot_be_reused_from_other_batch(self):
        data = fixture(); data['batch']['preferences']['default_order_batch_id'] = 'another-batch'
        errors, _ = validate(data)
        self.assertTrue(any('different batch' in e for e in errors))

    def test_company_actions_wait_for_company_order_confirmation(self):
        data = fixture(); r = data['roles'][0]
        r['execution']['fill'] = {'status': 'in_progress', 'evidence_ref': 'synthetic-fill'}
        r.pop('company_order_confirmation_ref')
        errors, _ = validate(data)
        self.assertTrue(any('same pre-form report' in e for e in errors))

    def test_pending_and_excluded_evidence_do_not_count_as_eligible_roles(self):
        for disposition in ['pending', 'excluded']:
            data = fixture(); data['roles'][0]['disposition'] = disposition
            errors, report = validate(data)
            self.assertEqual(errors, [])
            self.assertEqual(report['eligible_roles'], 0)
            self.assertEqual(report['eligible_companies'], {})

    def test_batch_rejects_missing_pre_form_report_and_stale_preferences(self):
        data = fixture(); data['roles'][0].pop('pre_form_report_ref')
        errors, _ = validate(data)
        self.assertTrue(any('pre_form_report_ref' in e for e in errors))
        data = fixture(); data['roles'][0]['preference_version'] = 'old'
        errors, _ = validate(data)
        self.assertTrue(any('stale role' in e for e in errors))

    # --- Issue #23 P0: prepared needs a real save branch; blocked needs an actionable explanation ---

    def prepared(self, fill=None, save=None):
        data = fixture(); r = data['roles'][0]
        r.update(stage='prepared', material_id='synthetic-resume')
        r['execution']['fill'] = fill if fill is not None else {
            'status': 'complete', 'evidence_ref': 'synthetic-fill', 'readback_ref': 'synthetic-fill-readback'}
        if save is not None:
            r['execution']['save'] = save
        return data

    def test_report_repro_prepared_without_save_is_rejected_and_not_counted(self):
        # Published counterexample: fill complete, save not_started, no field check.
        data = self.prepared(fill={'status': 'complete', 'evidence_ref': 'missing-file.png'})
        errors, report = validate(data)
        self.assertTrue(any('readback_ref' in e for e in errors))
        self.assertTrue(any('save complete, or save not_supported' in e for e in errors))
        self.assertEqual(report['prepared_applications'], 0)

    def test_prepared_with_saved_draft_needs_reopen_readback(self):
        data = self.prepared(save={'status': 'complete', 'evidence_ref': 'synthetic-draft'})
        errors, report = validate(data)
        self.assertTrue(any('save.readback_ref' in e for e in errors))
        self.assertEqual(report['prepared_applications'], 0)
        data['roles'][0]['execution']['save']['readback_ref'] = 'synthetic-reopened-draft'
        errors, report = validate(data)
        self.assertEqual(errors, [])
        self.assertEqual(report['prepared_applications'], 1)
        self.assertEqual(report['prepared_without_draft_page_must_stay_open'], 0)

    def test_site_without_drafts_is_reviewable_and_reported_separately(self):
        data = self.prepared(save={'status': 'not_supported'})
        errors, _ = validate(data)
        self.assertTrue(any('executed action needs evidence: save' in e for e in errors))
        data['roles'][0]['execution']['save']['evidence_ref'] = 'synthetic-only-cancel-and-submit'
        errors, report = validate(data)
        self.assertEqual(errors, [])
        self.assertEqual(report['prepared_applications'], 1)
        self.assertEqual(report['prepared_without_draft_page_must_stay_open'], 1)

    def test_not_supported_is_only_valid_for_save(self):
        data = self.prepared(fill={'status': 'not_supported', 'evidence_ref': 'x', 'readback_ref': 'y'},
                             save={'status': 'not_supported', 'evidence_ref': 'z'})
        errors, report = validate(data)
        self.assertTrue(any('missing actual execution state: fill' in e for e in errors))
        self.assertEqual(report['prepared_applications'], 0)

    def test_failed_or_uncertain_save_is_not_prepared(self):
        for status in ['in_progress', 'uncertain']:
            data = self.prepared(save={'status': status, 'evidence_ref': 'synthetic-save-attempt'})
            errors, report = validate(data)
            self.assertTrue(errors)
            self.assertEqual(report['prepared_applications'], 0)

    def test_report_repro_blocked_company_without_reason_is_rejected(self):
        # Published counterexample: blocked company with no reason or next step.
        data = fixture(); data['companies'][1].pop('blocked')
        errors, _ = validate(data)
        self.assertTrue(any("'beta' blocked needs a details object" in e for e in errors))
        data['companies'][1]['blocked'] = {}
        errors, _ = validate(data)
        for field in ['reason', 'next_action', 'unblock_owner', 'scope', 'evidence_ref']:
            self.assertTrue(any(field in e for e in errors), field)

    def test_agent_doable_work_cannot_be_labelled_blocked(self):
        data = fixture(); data['companies'][1]['blocked']['unblock_owner'] = 'agent'
        errors, _ = validate(data)
        self.assertTrue(any('Agent-doable work is pending' in e for e in errors))

    def test_blocked_company_is_listed_with_next_action(self):
        _, report = validate(fixture())
        self.assertEqual([c['company_key'] for c in report['blocked_companies']], ['beta'])
        self.assertTrue(report['blocked_companies'][0]['next_action'])

    def test_blocked_role_action_needs_reason_owner_and_next_step(self):
        data = fixture(); r = data['roles'][0]
        r['execution']['fill'] = {'status': 'blocked', 'evidence_ref': 'synthetic-required-id-field'}
        errors, _ = validate(data)
        self.assertTrue(any('execution.fill blocked needs reason' in e for e in errors))
        r['execution']['fill'].update(reason='government ID field is user-only', unblock_owner='user',
                                      next_action='ask user to enter it; other companies continue')
        errors, _ = validate(data)
        self.assertEqual(errors, [])

    def test_malformed_record_returns_errors_instead_of_crashing(self):
        data = {"batch": None, "companies": None, "roles": [None]}
        errors, _ = validate(data)
        self.assertTrue(any("batch must be an object" in error for error in errors))
        self.assertTrue(any("companies must be a list" in error for error in errors))
        self.assertTrue(any("each role must be an object" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
