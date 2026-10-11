"""Query, gate and evidence checks for the private batch ledger (stage contract v1.13).

Structural only: these checks never prove that a website saved, accepted or received anything,
and they never read personal data. Field meanings live in references/stage-contract.md and
references/daily-batch.md.
"""
import hashlib
import json
import re
from pathlib import Path

from preference_contract import text, isin

SHA256 = re.compile(r'^[0-9a-f]{64}$')
SUBSKILLS = {'login-phone-otp', 'login-wechat', 'captcha-solve', 'privacy-info-fill', 'terms-consent'}
LANES = {'in_app', 'chrome', 'playwright'}
CHANNEL_STATES = {'available', 'unavailable', 'not_applicable', 'not_checked'}
SOURCE_NAMES = {'router', 'profile', 'tracker', 'batch_record', 'resume'}
ELIGIBILITY = {'meets', 'pending', 'not_meets'}
COUNT_RULE_STATUS = {'verified', '未核实'}
REVIEW_PACKAGE_KEYS = ('materials', 'consequential_answers', 'account_limit', 'unresolved_fields', 'screenshots')
SUBMIT_STAGES = {'submit_clicked', 'submitted', 'uncertain'}
REVIEWED_STAGES = {'reviewed', 'submit_clicked', 'submitted'}


def review_hash_of(package):
    """Content hash of a review package; any substantive edit changes it (stage contract §8)."""
    canonical = json.dumps(package, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return 'sha256:' + hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def as_list(value):
    return value if isinstance(value, list) else []


def form_started(role):
    execution = role.get('execution') if isinstance(role.get('execution'), dict) else {}
    return any(isinstance(execution.get(a), dict) and execution[a].get('status') not in (None, 'not_started')
               for a in ('fill', 'save', 'submit'))


def is_history(role):
    return role.get('historical_readonly') is True


# ---------------------------------------------------------------- batch / Query

def automation_errors(auto):
    if not isinstance(auto, dict):
        return ['batch.automation must record the automation Query answer (off/semi/full)']
    errors = []
    mode = auto.get('automation_mode')
    approved = auto.get('approved_subskills')
    if not isin(mode, {'off', 'semi', 'full'}):
        errors.append('automation.automation_mode must be off, semi or full')
    if not isinstance(approved, list) or not all(isin(a, SUBSKILLS) for a in approved) or len(set(approved)) != len(approved):
        errors.append('automation.approved_subskills must list distinct known subskills')
        approved = []
    if mode == 'off' and approved:
        errors.append('automation off cannot approve subskills')
    if mode == 'full' and set(approved) != SUBSKILLS:
        errors.append('automation full enables all five subskills')
    if mode == 'semi' and not approved:
        errors.append('automation semi must name the approved subskills')
    if isin(mode, {'semi', 'full'}) and not text(auto.get('approval_ref')):
        errors.append('automation needs approval_ref for an enabled mode')
    refs = auto.get('confirmation_refs') if isinstance(auto.get('confirmation_refs'), dict) else {}

    def three(branch):
        items = refs.get(branch)
        return isinstance(items, list) and len(items) == 3 and all(text(i) for i in items) and len(set(items)) == 3

    if 'terms-consent' in approved and not isin(auto.get('terms_mode'), {'per_item', 'current_workflow_all'}):
        errors.append('terms-consent enabled: terms_mode must be asked in Query (per_item or current_workflow_all)')
    if auto.get('terms_mode') == 'current_workflow_all' and not three('terms_batch'):
        errors.append('terms_mode current_workflow_all needs three distinct confirmation refs')
    if auto.get('verification_mode') == 'agent_takeover' and not three('verification_takeover'):
        errors.append('verification agent_takeover needs three distinct confirmation refs')
    if auto.get('sms_read_allowed') is True and auto.get('verification_mode') != 'agent_takeover':
        errors.append('sms_read_allowed requires the confirmed agent_takeover branch')
    if refs.get('wechat_handoff') and not three('wechat_handoff'):
        errors.append('wechat screenshot handoff needs three distinct confirmation refs')
    if refs.get('wechat_handoff') and 'login-wechat' not in approved:
        errors.append('wechat handoff confirmations need login-wechat enabled')
    return errors


def query_errors(batch):
    errors = []
    entry = batch.get('entry')
    if not isinstance(entry, dict) or entry.get('intent') != 'application' or not text(entry.get('basis')) or not text(entry.get('ref')):
        errors.append('batch.entry must record intent application with basis and ref (research requests use the research workflow)')
    sources = batch.get('sources')
    if not isinstance(sources, list) or not sources:
        errors.append('batch.sources must list the router/profile/tracker/batch record/résumé as read')
        sources = []
    names = set()
    for item in sources:
        if not isinstance(item, dict) or not isin(item.get('name'), SOURCE_NAMES):
            errors.append('each batch source needs a known name')
            continue
        names.add(item['name'])
        if item.get('status') == 'missing':
            if not text(item.get('handling')):
                errors.append('missing source ' + item['name'] + ' needs its handling')
        elif not text(item.get('ref')) or not SHA256.match(str(item.get('sha256', ''))) or not text(item.get('read_at')):
            errors.append('source ' + item['name'] + ' needs ref, sha256 and read_at (or status missing)')
    if 'resume' not in names:
        errors.append('batch.sources must include the confirmed résumé')
    materials = batch.get('materials')
    if not isinstance(materials, list) or not materials:
        errors.append('batch.materials must list confirmed materials with sha256')
    else:
        seen = set()
        for item in materials:
            if (not isinstance(item, dict) or not text(item.get('material_id')) or not text(item.get('ref'))
                    or not SHA256.match(str(item.get('sha256', '')))):
                errors.append('each material needs material_id, ref and sha256')
            elif item['material_id'] in seen:
                errors.append('repeated material_id ' + item['material_id'])
            else:
                seen.add(item['material_id'])
    if type(batch.get('role_selection_authorized')) is not bool or not text(batch.get('authorization_ref')):
        errors.append('batch.role_selection_authorized (boolean) and authorization_ref are required')
    if not isin(batch.get('application_execution_mode'), {'single', 'parallel'}) or not text(batch.get('mode_approval_ref')):
        errors.append('batch.application_execution_mode (single/parallel) and mode_approval_ref are required')
    errors.extend(automation_errors(batch.get('automation')))
    channels = batch.get('channels')
    if not isinstance(channels, dict) or any(not isin(channels.get(k), CHANNEL_STATES) for k in ('in_app', 'chrome', 'computer_use', 'system_script', 'playwright')):
        errors.append('batch.channels must record in_app/chrome/computer_use/system_script/playwright preflight states')
    browser = batch.get('browser') if isinstance(batch.get('browser'), dict) else {}
    sub = browser.get('playwright_substitute')
    if sub is not None and (not isinstance(sub, dict) or type(sub.get('approved')) is not bool or (sub.get('approved') and not text(sub.get('ref')))):
        errors.append('browser.playwright_substitute needs approved (boolean) and ref when approved')
    return errors


def material_ids(batch):
    items = batch.get('materials') if isinstance(batch.get('materials'), list) else []
    return {m.get('material_id') for m in items if isinstance(m, dict) and isinstance(m.get('material_id'), str)}


# ---------------------------------------------------------------- companies

def count_rule_errors(rule, label):
    if not isinstance(rule, dict):
        return [label + ' needs count_rule (application-count rule gate) before form actions']
    errors = []
    if not isin(rule.get('status'), COUNT_RULE_STATUS):
        errors.append(label + ' count_rule.status must be verified or 未核实')
    maximum = rule.get('max_applications')
    if maximum is not None and (type(maximum) is not int or maximum < 1):
        errors.append(label + ' count_rule.max_applications must be a positive integer or null')
    if rule.get('status') == 'verified':
        if maximum is None:
            errors.append(label + ' verified count_rule needs max_applications')
        for field in ('source', 'checked_at'):
            if not text(rule.get(field)):
                errors.append(label + ' verified count_rule needs ' + field)
    return errors


def company_errors(company, company_roles, batch):
    """Lane, count-rule and sequencing checks for a company with started roles."""
    errors = []
    key = company.get('company_key')
    label = 'company ' + repr(key)
    live = [r for r in company_roles if not is_history(r)]
    started = [r for r in live if form_started(r) or isin(r.get('stage'), {'preparing', 'prepared'} | REVIEWED_STAGES | SUBMIT_STAGES)]
    lane = company.get('browser_lane')
    if lane is not None and not isin(lane, LANES):
        errors.append(label + ' browser_lane must be in_app, chrome or playwright')
    if started and not isin(lane, LANES):
        errors.append(label + ' needs browser_lane before form actions')
    sub = (batch.get('browser') or {}).get('playwright_substitute') if isinstance(batch.get('browser'), dict) else None
    if lane == 'playwright' and not (isinstance(sub, dict) and sub.get('approved') is True and text(sub.get('ref'))):
        errors.append(label + ' uses playwright without an approved substitute for the Chrome lane')
    for change in as_list(company.get('lane_history')):
        if not isinstance(change, dict) or not isin(change.get('from'), LANES) or not isin(change.get('to'), LANES) or not text(change.get('handoff_ref')):
            errors.append(label + ' lane change needs from/to lanes and handoff_ref')
    if not started:
        return errors
    rule = company.get('count_rule')
    errors.extend(count_rule_errors(rule, label))
    if not isinstance(rule, dict):
        return errors
    submitting = [r for r in live if isin(r.get('stage'), SUBMIT_STAGES)]
    prior_submitted = company.get('prior_submitted_count', 0)
    if type(prior_submitted) is not int or prior_submitted < 0:
        errors.append(label + ' prior_submitted_count must be a nonnegative integer')
        prior_submitted = 0
    maximum = rule.get('max_applications')
    if type(maximum) is int:
        if len(submitting) + prior_submitted > maximum:
            errors.append(label + ' exceeds the site application limit')
        reviewed = [r for r in live if isin(r.get('stage'), REVIEWED_STAGES | {'prepared'})]
        if len(reviewed) + prior_submitted > maximum and not text(company.get('count_choice_ref')):
            errors.append(label + ' has more prepared roles than the site accepts; record the user choice in count_choice_ref')
    if rule.get('status') == '未核实' and not text(company.get('first_submit_readback_ref')):
        targeted = [r for r in live if isinstance(r.get('target_confirmation'), dict)]
        if len(submitting) > 1 or len(targeted) > 1:
            errors.append(label + ' has an unverified count rule: confirm/submit only the first target until first_submit_readback_ref')
    return errors


# ---------------------------------------------------------------- roles

def role_errors(role, batch, materials):
    if is_history(role):
        return []
    errors = []
    key = role.get('role_key')
    label = 'role ' + repr(key)
    stage = role.get('stage') if isinstance(role.get('stage'), str) else None
    site_reconciled = stage == 'submitted' and text(role.get('receipt_ref')) and text(role.get('site_history_ref'))
    if (form_started(role) or stage in {'prepared'} | REVIEWED_STAGES | SUBMIT_STAGES) and not site_reconciled:
        eligibility = role.get('eligibility')
        if not isinstance(eligibility, dict) or not isin(eligibility.get('conclusion'), ELIGIBILITY) or not text(eligibility.get('ref')):
            errors.append(label + ' needs an eligibility conclusion (meets/pending/not_meets) with ref before form actions')
        elif eligibility['conclusion'] != 'meets' and not text(eligibility.get('user_attempt_ref')):
            errors.append(label + ' eligibility is ' + eligibility['conclusion'] + '; forms need the user\'s specific attempt instruction')
        if role.get('disposition') == 'primary' and batch.get('role_selection_authorized') is not True and not text(role.get('selection_ref')):
            errors.append(label + ' was selected without role-selection authority or a user selection_ref')
    if role.get('material_id') and materials and not isin(role.get('material_id'), materials):
        errors.append(label + ' material_id is not a confirmed batch material')
    if stage in REVIEWED_STAGES or (stage == 'uncertain' and role.get('review_hash')):
        package = role.get('review_package')
        if not isinstance(package, dict) or any(k not in package for k in REVIEW_PACKAGE_KEYS):
            errors.append(label + ' review_package must include ' + '/'.join(REVIEW_PACKAGE_KEYS))
        elif role.get('review_hash') != review_hash_of(package):
            errors.append(label + ' review_package changed after review_hash; substantive change needs a new review version')
    if stage in SUBMIT_STAGES - {'uncertain'} or (stage == 'uncertain' and role.get('approval_ref')):
        if not text(role.get('presubmit_check_ref')):
            errors.append(label + ' needs presubmit_check_ref (role, plan, quota, materials, version recheck)')
        target = role.get('target_confirmation')
        if not isinstance(target, dict):
            errors.append(label + ' needs target_confirmation before the submit click')
        else:
            for field in ('company', 'bu', 'title'):
                if target.get(field) != role.get(field):
                    errors.append(label + ' target_confirmation.' + field + ' does not match the role')
            if not isinstance(role.get('cities'), list) or not isin(target.get('location'), role.get('cities')):
                errors.append(label + ' target_confirmation.location must be one of the role cities')
            if not isinstance(target.get('intent_slots'), list) or not all(text(s) for s in target.get('intent_slots')):
                errors.append(label + ' target_confirmation.intent_slots must list slots in submission order ([] if none)')
            for field in ('count_rule_line', 'confirmation_ref'):
                if not text(target.get(field)):
                    errors.append(label + ' target_confirmation needs ' + field)
            if target.get('review_hash') != role.get('review_hash'):
                errors.append(label + ' target_confirmation belongs to another review version')
    if role.get('tracker_status') == 'submitted' and not text(role.get('tracker_readback_ref')):
        errors.append(label + ' tracker submitted status needs tracker_readback_ref')
    recovery = role.get('recovery')
    if recovery is not None and (not isinstance(recovery, dict) or not text(recovery.get('ref')) or not text(recovery.get('result'))):
        errors.append(label + ' recovery needs ref and result')
    return errors


# ---------------------------------------------------------------- evidence files

def iter_refs(node, path=''):
    if isinstance(node, dict):
        for k, v in node.items():
            child = path + '.' + str(k) if path else str(k)
            if isinstance(v, str) and (k.endswith('_ref') or k == 'ref'):
                yield child, v
            elif isinstance(v, list) and (k.endswith('_refs') or k.endswith('_ref')):
                for i, item in enumerate(v):
                    if isinstance(item, str):
                        yield child + '[' + str(i) + ']', item
                    else:
                        yield from iter_refs(item, child + '[' + str(i) + ']')
            else:
                yield from iter_refs(v, child)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from iter_refs(item, path + '[' + str(i) + ']')


def evidence_errors(data, root):
    """Check every `file:<relative path>` reference exists inside root (self-reported refs are not evidence)."""
    base = Path(root).resolve()
    errors = []
    for where, ref in iter_refs(data):
        if not ref.startswith('file:'):
            continue
        target = (base / ref[5:]).resolve()
        if base != target and base not in target.parents:
            errors.append(where + ' points outside the evidence root')
        elif not target.is_file():
            errors.append(where + ' evidence file not found: ' + ref[5:])
    return errors


# ---------------------------------------------------------------- closeout

def closeout_status(data, report):
    """Stage contract §11: may this batch be declared finished?"""
    reasons = []
    batch = data.get('batch') if isinstance(data.get('batch'), dict) else {}
    companies = [c for c in as_list(data.get('companies')) if isinstance(c, dict)]
    roles = [r for r in as_list(data.get('roles')) if isinstance(r, dict) and not is_history(r)]
    blocked = {c.get('company_key') for c in companies if c.get('state') == 'blocked' and isinstance(c.get('company_key'), str)}
    for c in companies:
        if isin(c.get('state'), {'unvisited', 'checking'}):
            reasons.append('company ' + repr(c.get('company_key')) + ' is ' + c['state'] + ' and not blocked: Agent work remains')
    for r in roles:
        actions = r.get('execution') if isinstance(r.get('execution'), dict) else {}
        role_blocked = any(isinstance(a, dict) and a.get('status') == 'blocked' for a in actions.values())
        if isin(r.get('company_key'), blocked) or role_blocked or r.get('disposition') != 'primary':
            continue
        if isin(r.get('stage'), {'verified', 'preparing'}):
            reasons.append('role ' + repr(r.get('role_key')) + ' is ' + r['stage'] + ' and not blocked: Agent work remains')
        if isin(r.get('stage'), {'submit_clicked', 'uncertain'}):
            reasons.append('role ' + repr(r.get('role_key')) + ' has an unreconciled submission attempt')
    remaining = report.get('remaining_quota') or {}
    if not text(batch.get('stop_reached_ref')):
        open_buckets = [b for b, v in remaining.items() if v is None or v > 0]
        if open_buckets:
            reasons.append('buckets ' + ', '.join(sorted(open_buckets)) + ' have no reached target and no stop_reached_ref')
    return {'can_close': not reasons, 'reasons': reasons}
