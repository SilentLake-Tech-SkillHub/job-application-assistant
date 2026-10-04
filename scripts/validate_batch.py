#!/usr/bin/env python3
"""Validate a private batch ledger and report separate progress counts.

Input JSON is supplied at runtime; no candidate or employer data is bundled here.
This catches structural mistakes, not whether website evidence is genuine.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

COMPANY_STATES = {"unvisited", "checking", "checked", "blocked"}
ROLE_STAGES = {
    "discovered", "verified", "preparing", "prepared", "reviewed",
    "submit_clicked", "submitted", "uncertain",
}
ELIGIBLE_STAGES = ROLE_STAGES - {"discovered"}
PREPARED_STAGES = {"prepared", "reviewed", "submit_clicked", "submitted", "uncertain"}


def validate(data):
    errors = []
    batch = data.get("batch", {})
    if not isinstance(batch, dict):
        errors.append("batch must be an object")
        batch = {}
    quotas = batch.get("quotas", {})
    if not isinstance(quotas, dict) or not quotas:
        errors.append("batch.quotas must be a nonempty bucket-to-target map (integer or null)")
        quotas = {}
    for bucket, quota in quotas.items():
        if not isinstance(bucket, str) or not bucket or (quota is not None and (type(quota) is not int or quota < 0)):
            errors.append(f"invalid quota for bucket {bucket!r}")
    if any(quota is None for quota in quotas.values()):
        for field in ("target_choice_ref", "stop_condition"):
            value = batch.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"batch.{field} is required for a null numeric target")
    if batch.get("counting_basis") not in {"checked", "eligible"}:
        errors.append("batch.counting_basis must be checked or eligible")
    if batch.get("replacement_rule") not in {"replace", "keep_gap"}:
        errors.append("batch.replacement_rule must be replace or keep_gap")
    if batch.get("bucket_rules_confirmed") is not True:
        errors.append("batch.bucket_rules_confirmed must be true")
    if batch.get("scope_confirmed") is not True:
        errors.append("batch.scope_confirmed must be true")
    if batch.get("materials_confirmed") is not True:
        errors.append("batch.materials_confirmed must be true")
    if batch.get("preparation_authorized") is not True:
        errors.append("batch.preparation_authorized must be true")
    if not batch.get("batch_id") or not batch.get("query_version"):
        errors.append("batch_id and query_version are required")

    raw_companies = data.get("companies", [])
    if not isinstance(raw_companies, list):
        errors.append("companies must be a list")
        raw_companies = []
    companies = {}
    for company in raw_companies:
        if not isinstance(company, dict):
            errors.append("each company must be an object")
            continue
        key = company.get("company_key")
        bucket = company.get("bucket")
        state = company.get("state")
        if not key or key in companies:
            errors.append(f"missing or repeated company_key: {key!r}")
        if bucket not in quotas:
            errors.append(f"company {key!r} has an unconfigured bucket: {bucket!r}")
        if state not in COMPANY_STATES:
            errors.append(f"company {key!r} has invalid state: {state!r}")
        if key:
            companies[key] = company

    role_keys = set()
    role_urls = set()
    roles = data.get("roles", [])
    if not isinstance(roles, list):
        errors.append("roles must be a list")
        roles = []
    for role in roles:
        if not isinstance(role, dict):
            errors.append("each role must be an object")
            continue
        key = role.get("role_key")
        url = role.get("direct_url")
        company_key = role.get("company_key")
        stage = role.get("stage")
        if not key or key in role_keys:
            errors.append(f"missing or repeated role_key: {key!r}")
        if key:
            role_keys.add(key)
        if company_key not in companies:
            errors.append(f"role {key!r} references unknown company {company_key!r}")
        if stage not in ROLE_STAGES:
            errors.append(f"role {key!r} has invalid stage {stage!r}")
        if stage in ELIGIBLE_STAGES and not url:
            errors.append(f"role {key!r} needs a direct URL")
        if url:
            if url in role_urls:
                errors.append(f"repeated direct role URL: {url}")
            role_urls.add(url)
        if stage in PREPARED_STAGES and not role.get("material_id"):
            errors.append(f"role {key!r} needs a material identity")
        if stage in {"reviewed", "submit_clicked", "submitted"} and not role.get("review_hash"):
            errors.append(f"role {key!r} needs a review hash")
        if stage in {"submit_clicked", "submitted"}:
            if role.get("approved_review_hash") != role.get("review_hash"):
                errors.append(f"role {key!r} lacks approval for its current review version")
            if not role.get("approval_ref"):
                errors.append(f"role {key!r} needs a user approval reference")
        if stage == "submitted" and not role.get("receipt_ref"):
            errors.append(f"role {key!r} needs an official receipt reference")
        if stage != "submitted" and role.get("tracker_status") == "submitted":
            errors.append(f"role {key!r} has submitted tracker status without a verified stage")

    checked = Counter(c["bucket"] for c in companies.values() if c.get("state") == "checked" and c.get("bucket") in quotas)
    valid_roles = [role for role in roles if isinstance(role, dict)]
    eligible_companies = {role.get("company_key") for role in valid_roles if role.get("stage") in ELIGIBLE_STAGES}
    eligible_company_counts = Counter(companies[k]["bucket"] for k in eligible_companies if k in companies and companies[k].get("bucket") in quotas)
    achieved = checked if batch.get("counting_basis") == "checked" else eligible_company_counts
    report = {
        "batch_id": batch.get("batch_id"),
        "checked_companies": dict(checked),
        "eligible_companies": dict(eligible_company_counts),
        "eligible_roles": sum(role.get("stage") in ELIGIBLE_STAGES for role in valid_roles),
        "prepared_applications": sum(role.get("stage") in PREPARED_STAGES for role in valid_roles),
        "verified_submissions": sum(role.get("stage") == "submitted" and bool(role.get("receipt_ref")) for role in valid_roles),
        "uncertain_roles": sum(role.get("stage") in {"submit_clicked", "uncertain"} for role in valid_roles),
        "remaining_quota": {b: (None if q is None else max(q - achieved[b], 0)) for b, q in quotas.items() if q is None or (type(q) is int and q >= 0)},
    }
    return errors, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch_json", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.batch_json.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("root must be an object")
    except (OSError, ValueError) as exc:
        print(json.dumps({"valid": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 2
    errors, report = validate(data)
    print(json.dumps({"valid": not errors, "errors": errors, "report": report}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
