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
            "preferences": preferences(),
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
            {"company_key": "beta", "bucket": "bank", "state": "blocked"},
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

    def test_malformed_record_returns_errors_instead_of_crashing(self):
        data = {"batch": None, "companies": None, "roles": [None]}
        errors, _ = validate(data)
        self.assertTrue(any("batch must be an object" in error for error in errors))
        self.assertTrue(any("companies must be a list" in error for error in errors))
        self.assertTrue(any("each role must be an object" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
