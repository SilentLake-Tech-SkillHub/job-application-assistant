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
from preference_contract import validate_snapshot, preparation_errors, blocked_errors, isin
from ledger_checks import (query_errors, company_errors, role_errors, material_ids,
                           evidence_errors, closeout_status, find_root)

COMPANY_STATES = {"unvisited", "checking", "checked", "blocked"}
ROLE_STAGES = {
    "discovered", "verified", "preparing", "prepared", "reviewed",
    "submit_clicked", "submitted", "uncertain",
}
ELIGIBLE_STAGES = ROLE_STAGES - {"discovered"}
PREPARED_STAGES = {"prepared", "reviewed", "submit_clicked", "submitted", "uncertain"}


def is_prepared(role):
    """Counting rule: a submitted role needs its receipt; any other stage needs the full fill/save evidence branch."""
    execution = role.get("execution")
    if not isinstance(execution, dict):
        return False
    if role.get("stage") == "submitted":
        return bool(role.get("receipt_ref"))
    return not preparation_errors(execution)


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
    if not isin(batch.get("counting_basis"), {"checked", "eligible"}):
        errors.append("batch.counting_basis must be checked or eligible")
    if not isin(batch.get("replacement_rule"), {"replace", "keep_gap"}):
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
    errors.extend(query_errors(batch))
    materials = material_ids(batch)

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
        if not isinstance(key, str) or not key or key in companies:
            errors.append(f"missing or repeated company_key: {key!r}")
        if not isin(bucket, quotas):
            errors.append(f"company {key!r} has an unconfigured bucket: {bucket!r}")
        if not isin(state, COMPANY_STATES):
            errors.append(f"company {key!r} has invalid state: {state!r}")
        if state == "blocked":
            errors.extend(blocked_errors(company.get("blocked"), f"company {key!r}", require_scope=True))
        if isinstance(key, str) and key:
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
        if not isinstance(key, str) or not key or key in role_keys:
            errors.append(f"missing or repeated role_key: {key!r}")
        if isinstance(key, str) and key:
            role_keys.add(key)
        if not isin(company_key, companies):
            errors.append(f"role {key!r} references unknown company {company_key!r}")
        if not isin(stage, ROLE_STAGES):
            errors.append(f"role {key!r} has invalid stage {stage!r}")
            stage = None
        if stage in ELIGIBLE_STAGES and not url:
            errors.append(f"role {key!r} needs a direct URL")
        if url and not isinstance(url, str):
            errors.append(f"role {key!r} direct URL must be a string")
        elif url:
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
        errors.extend(role_errors(role, batch, materials))

    by_company = {}
    for role in roles:
        if isinstance(role, dict) and isinstance(role.get("company_key"), str):
            by_company.setdefault(role.get("company_key"), []).append(role)
    for key, company in companies.items():
        errors.extend(company_errors(company, by_company.get(key, []), batch))

    errors.extend(validate_snapshot(batch.get("preferences"), roles, raw_companies, data.get("prior_roles"), batch_id=batch.get("batch_id")))

    checked = Counter(c["bucket"] for c in companies.values() if c.get("state") == "checked" and isin(c.get("bucket"), quotas))
    valid_roles = [role for role in roles if isinstance(role, dict)]
    eligible_roles = [role for role in valid_roles if isin(role.get("stage"), ELIGIBLE_STAGES) and isin(role.get("disposition"), {"primary"}) and role.get("hard_scope_pass") is True]
    eligible_companies = {role.get("company_key") for role in eligible_roles if isinstance(role.get("company_key"), str)}
    eligible_company_counts = Counter(companies[k]["bucket"] for k in eligible_companies if k in companies and isin(companies[k].get("bucket"), quotas))
    achieved = Counter(checked if batch.get("counting_basis") == "checked" else eligible_company_counts)
    # Stage contract §9: keep_gap counts blocked or role-free companies as kept gaps (no replacement);
    # replace leaves them out so the remaining target asks for a replacement company.
    gap_keys = [k for k, c in companies.items() if isin(c.get("bucket"), quotas) and (
        c.get("state") == "blocked" or (c.get("state") == "checked" and k not in eligible_companies))]
    if batch.get("counting_basis") == "checked":
        gap_keys = [k for k in gap_keys if companies[k].get("state") == "blocked"]
    kept_gaps = Counter(companies[k]["bucket"] for k in gap_keys) if batch.get("replacement_rule") == "keep_gap" else Counter()
    achieved.update(kept_gaps)
    prepared_roles = [role for role in eligible_roles
                      if isin(role.get("stage"), PREPARED_STAGES) and role.get("material_id")
                      and is_prepared(role)]
    unsaved = [role for role in prepared_roles if role.get("stage") != "submitted"
               and role["execution"]["save"].get("status") == "not_supported"]
    blocked_companies = [{"company_key": k, "next_action": (c.get("blocked") if isinstance(c.get("blocked"), dict) else {}).get("next_action")}
                         for k, c in companies.items() if c.get("state") == "blocked"]
    report = {
        "batch_id": batch.get("batch_id"),
        "checked_companies": dict(checked),
        "eligible_companies": dict(eligible_company_counts),
        "eligible_roles": len(eligible_roles),
        "prepared_applications": len(prepared_roles),
        "prepared_without_draft_page_must_stay_open": len(unsaved),
        "blocked_companies": blocked_companies,
        "verified_submissions": sum(role.get("stage") == "submitted" and bool(role.get("receipt_ref")) for role in valid_roles),
        "uncertain_roles": sum(isin(role.get("stage"), {"submit_clicked", "uncertain"}) for role in valid_roles),
        "kept_gaps": dict(kept_gaps),
        "replacement_needed": dict(Counter(companies[k]["bucket"] for k in gap_keys)) if batch.get("replacement_rule") == "replace" else {},
        "remaining_quota": {b: (None if q is None else max(q - achieved[b], 0)) for b, q in quotas.items() if q is None or (type(q) is int and q >= 0)},
    }
    return errors, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch_json", type=Path)
    parser.add_argument("--root", type=Path, help="application root containing 投递证据/ (default: nearest ancestor of the ledger)")
    parser.add_argument("--lenient", action="store_true", help="legacy ledgers only: skip the strict file-evidence check")
    parser.add_argument("--closeout", action="store_true", help="also report whether the batch may be closed")
    args = parser.parse_args()
    try:
        data = json.loads(args.batch_json.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("root must be an object")
    except (OSError, ValueError) as exc:
        print(json.dumps({"valid": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 2
    errors, report = validate(data)
    if not args.lenient:
        root = args.root or find_root(args.batch_json)
        if root is None:
            errors.append("strict evidence: no 投递证据/ folder found above the ledger; pass --root or --lenient")
        else:
            errors.extend(evidence_errors(data, root))
    result = {"valid": not errors, "errors": errors, "report": report}
    if args.closeout:
        result["closeout"] = closeout_status(data, report)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors and (not args.closeout or result["closeout"]["can_close"]) else 1


if __name__ == "__main__":
    sys.exit(main())
