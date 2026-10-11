"""Structural consistency only: no JD interpretation, source authentication or hooks."""
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def text(value):
    return isinstance(value, str) and bool(value.strip())


def isin(value, allowed):
    """Membership that tolerates unhashable values (lists/dicts from malformed ledgers)."""
    try:
        return value in allowed
    except TypeError:
        return False


def strings(value):
    return isinstance(value, list) and all(text(item) for item in value)


def canonical_url(value):
    if not text(value):
        return ''
    try:
        parts = urlsplit(value)
        if parts.scheme not in {'http', 'https'} or not parts.netloc:
            return ''
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                 if not k.lower().startswith('utm_') and k.lower() not in {'ref', 'source'}]
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, urlencode(sorted(query)), parts.fragment))
    except ValueError:
        return ''


ACTION_STATES = {'not_started', 'in_progress', 'complete', 'blocked', 'uncertain'}
# Only `save` may be not_supported: the site offers no draft, so the filled page itself is the reviewable state.
SAVE_ONLY_STATES = {'not_supported'}
# Stages whose meaning is "the form is ready"; submitted is excluded because its official receipt supersedes draft evidence.
READY_STAGES = {'prepared', 'reviewed', 'submit_clicked'}


def preparation_errors(execution):
    """Return why a form may not count as prepared; empty means the evidence branches are complete."""
    errors = []
    fill = execution.get('fill') if isinstance(execution.get('fill'), dict) else {}
    save = execution.get('save') if isinstance(execution.get('save'), dict) else {}
    if fill.get('status') != 'complete' or not text(fill.get('evidence_ref')):
        errors.append('prepared/later stage requires completed fill evidence')
    elif not text(fill.get('readback_ref')):
        errors.append('prepared needs fill.readback_ref (field-by-field readback after filling)')
    if save.get('status') == 'complete':
        if not text(save.get('evidence_ref')) or not text(save.get('readback_ref')):
            errors.append('prepared via draft needs save.evidence_ref and save.readback_ref (reopened draft readback)')
    elif save.get('status') == 'not_supported':
        if not text(save.get('evidence_ref')):
            errors.append('save not_supported needs evidence that the site offers no draft')
    else:
        errors.append('prepared needs save complete, or save not_supported on a site without drafts')
    return errors


# Who can lift a block. The Agent itself is deliberately absent: work the Agent is authorized
# and able to do is pending work, not a block, and must not end the batch.
UNBLOCK_OWNERS = {'user', 'site', 'platform', 'official_rule'}
BLOCK_SCOPES = {'role', 'company', 'shared_account', 'batch'}


def blocked_errors(item, label, require_scope=False):
    """A blocked state must say why, who can unblock it and what happens next (and, for companies, what it affects)."""
    errors = []
    if not isinstance(item, dict):
        return [label + ' blocked needs a details object']
    for field in ['reason', 'next_action']:
        if not text(item.get(field)):
            errors.append(label + ' blocked needs ' + field)
    if not isin(item.get('unblock_owner'), UNBLOCK_OWNERS):
        errors.append(label + ' blocked needs unblock_owner in ' + '/'.join(sorted(UNBLOCK_OWNERS))
                      + ' (Agent-doable work is pending, not blocked)')
    if require_scope:
        if not isin(item.get('scope'), BLOCK_SCOPES):
            errors.append(label + ' blocked needs scope in ' + '/'.join(sorted(BLOCK_SCOPES)))
        if not text(item.get('evidence_ref')):
            errors.append(label + ' blocked needs evidence_ref')
    return errors


def identity(role):
    company = role.get('company_key')
    if not text(company):
        return ''
    job_id = role.get('official_job_id')
    if text(job_id):
        return company + ':id:' + job_id
    url = canonical_url(role.get('direct_url'))
    return company + ':url:' + url if url else ''


def validate_preferences(preferences):
    errors = []
    if not isinstance(preferences, dict):
        return ['preferences must be an object (legacy snapshots require reviewed adaptation)']
    for field in ['version', 'confirmation_ref', 'effective_at']:
        if not text(preferences.get(field)):
            errors.append('preferences missing ' + field)
    if not strings(preferences.get('recheck_scope')):
        errors.append('recheck_scope must list user-selected gaps; [] permits no recheck')
    if preferences.get('supersedes_version') is not None and not text(preferences.get('supersedes_version')):
        errors.append('supersedes_version must be null or a nonempty version')
    scope = preferences.get('hard_scope')
    if not isinstance(scope, dict) or not strings(scope.get('cities')):
        errors.append('hard_scope.cities must be a string list; [] means unrestricted')
    if not isin(preferences.get('internship_policy'), {'excluded', 'conversion_last', 'separate'}):
        errors.append('invalid internship_policy')
    if preferences.get('conflict_policy') != 'user_decides':
        errors.append('cross-axis conflicts require user_decides')
    for field in ['default_role_order', 'default_order_confirmation_ref', 'default_order_batch_id']:
        if not text(preferences.get(field)):
            errors.append('preferences missing ' + field)
    axes = preferences.get('axes')
    if not isinstance(axes, dict):
        axes = {}
    for axis in ['employment', 'city', 'direction']:
        item = axes.get(axis)
        if not isinstance(item, dict) or not text(item.get('raw')) or not isinstance(item.get('relations'), list):
            errors.append('missing raw wording/relations for axis ' + axis)
            continue
        for relation in item['relations']:
            if (not isinstance(relation, dict) or not text(relation.get('higher'))
                    or not text(relation.get('lower')) or not isin(relation.get('relation'), {'strict', 'weak', 'tied', 'unknown'})):
                errors.append('invalid relation in axis ' + axis)
    if preferences.get('combined_weights') is not None or preferences.get('auto_resolve_conflicts') is True:
        errors.append('no automatic weighted cross-axis choice')
    return errors


def formal_errors(company):
    if (company.get('formal_coverage') != 'sufficient'
            or not strings(company.get('formal_coverage_refs')) or not company.get('formal_coverage_refs')
            or company.get('suitable_formal_found') is not False
            or not text(company.get('no_suitable_formal_ref'))):
        return ['no-formal conclusion requires sufficient coverage and no suitable formal evidence']
    return []


def valid_readonly_history(role, prior_roles):
    if not isinstance(prior_roles, list):
        return False
    prior = next((item for item in prior_roles if isinstance(item, dict)
                  and item.get('role_key') == role.get('role_key')), None)
    if prior is None or prior.get('stage') != 'submitted' or not text(prior.get('receipt_ref')) or not isinstance(prior.get('execution'), dict):
        return False
    if any(role.get(field) != prior.get(field) for field in ['stage', 'receipt_ref', 'execution', 'material_id',
        'review_hash', 'approved_review_hash', 'approval_ref', 'selected', 'selection_ref']):
        return False
    actions = role.get('current_batch_execution')
    return isinstance(actions, dict) and all(actions.get(a) == {'status': 'not_started'} for a in ['fill', 'save', 'submit'])


def validate_snapshot(preferences, roles, companies, prior_roles=None, batch_id=None):
    errors = validate_preferences(preferences)
    prefs = preferences if isinstance(preferences, dict) else {}
    version = prefs.get('version')
    if batch_id is not None and prefs.get('default_order_batch_id') != batch_id:
        errors.append('default role order belongs to a different batch; ask anew')
    companies = companies if isinstance(companies, list) else []
    by_company = {c['company_key']: c for c in companies if isinstance(c, dict) and text(c.get('company_key'))}
    for company in companies:
        if isinstance(company, dict) and company.get('no_suitable_formal_found') is True:
            errors.extend(formal_errors(company))
    if not isinstance(roles, list):
        return errors + ['roles must be a list']
    seen, current = set(), {}
    conversion_seen = False
    for role in roles:
        if not isinstance(role, dict):
            errors.append('role evidence must be an object')
            continue
        key = identity(role)
        if not key or role.get('role_key') != key:
            errors.append('role_key must use recruiting-company official ID or canonical direct URL')
        if key in seen:
            errors.append('duplicate official role identity (including multi-city role)')
        seen.add(key)
        if key:
            current[key] = role
        if role.get('preference_version') != version or not text(version):
            errors.append('stale role preference_version')
        # Discovered clues remain pending, never presented as a complete verified JD.
        if role.get('stage') == 'discovered':
            if role.get('disposition') != 'pending':
                errors.append('discovered clue must remain pending')
            if not text(role.get('pre_form_report_ref')) or role.get('report_precedes_form') is not True:
                errors.append('discovered clue needs a pre-form report identifying pending evidence')
            execution = role.get('execution')
            if not isinstance(execution, dict) or any(not isinstance(execution.get(a), dict) or execution[a].get('status') != 'not_started' for a in ['fill', 'save', 'submit']):
                errors.append('discovered clue cannot perform form actions')
            continue
        for field in ['company', 'title', 'direct_url', 'bu', 'employment_type', 'direction',
                      'jd_full_text', 'jd_capture_ref', 'jd_basis', 'decision_reason', 'pre_form_report_ref']:
            if not text(role.get(field)):
                errors.append('role evidence missing ' + field)
        if not canonical_url(role.get('direct_url')):
            errors.append('role needs an actual direct URL')
        if not strings(role.get('cities')) or not role.get('cities'):
            errors.append('role cities must be explicit or 未披露')
        if not isin(role.get('decision_basis'), {'jd', 'scope'}):
            errors.append('decision must use JD or confirmed scope, never title blacklist')
        if type(role.get('hard_scope_pass')) is not bool:
            errors.append('hard_scope_pass must be boolean')
        disposition = role.get('disposition')
        if not isin(disposition, {'primary', 'pending', 'excluded'}):
            errors.append('invalid disposition')
        if disposition == 'primary' and role.get('hard_scope_pass') is not True:
            errors.append('candidate must pass hard scope')
        scope = prefs.get('hard_scope', {})
        allowed = scope.get('cities', []) if isinstance(scope, dict) else []
        if (strings(allowed) and allowed and strings(role.get('cities'))
                and not set(allowed).intersection(role['cities']) and disposition == 'primary'):
            errors.append('candidate outside explicit hard city scope')
        if role.get('employment_type') == 'internship' and disposition == 'primary':
            if prefs.get('internship_policy') == 'conversion_last':
                if not text(role.get('conversion_ref')):
                    errors.append('conversion internship needs official conversion evidence')
                if role.get('display_position') != 'last':
                    errors.append('conversion internship belongs last in the same report')
                conversion_seen = True
            elif prefs.get('internship_policy') != 'separate':
                errors.append('internship excluded by confirmed policy')
        elif disposition == 'primary' and conversion_seen and prefs.get('internship_policy') == 'conversion_last':
            errors.append('formal candidate cannot follow conversion internships in the report')
        if role.get('report_precedes_form') is not True:
            errors.append('pre-form per-role report required before form action')
        execution = role.get('execution')
        if not isinstance(execution, dict):
            execution = {}
        form_started = False
        for action in ['fill', 'save', 'submit']:
            item = execution.get(action)
            allowed = ACTION_STATES | (SAVE_ONLY_STATES if action == 'save' else set())
            if not isinstance(item, dict) or not isin(item.get('status'), allowed):
                errors.append('missing actual execution state: ' + action)
                continue
            if item['status'] != 'not_started':
                form_started = True
                if not text(item.get('evidence_ref')):
                    errors.append('executed action needs evidence: ' + action)
            if item['status'] == 'blocked':
                errors.extend(blocked_errors(item, 'execution.' + action))
            if action == 'submit' and item['status'] == 'complete' and (role.get('stage') != 'submitted' or not text(role.get('receipt_ref'))):
                errors.append('submit complete needs submitted stage and receipt')
        fill_state = execution.get('fill') if isinstance(execution.get('fill'), dict) else {}
        submit_state = execution.get('submit') if isinstance(execution.get('submit'), dict) else {}
        if isin(role.get('stage'), READY_STAGES):
            errors.extend(preparation_errors(execution))
        elif role.get('stage') == 'submitted' and fill_state.get('status') != 'complete':
            errors.append('prepared/later stage requires completed fill evidence')
        if role.get('stage') == 'submitted' and submit_state.get('status') != 'complete':
            errors.append('submitted stage requires complete submit evidence')
        if form_started and isin(disposition, {'pending', 'excluded'}):
            errors.append('pending/excluded role cannot start forms')
        readonly_history = role.get('historical_readonly') is True and valid_readonly_history(role, prior_roles)
        if role.get('historical_readonly') is True and not readonly_history:
            errors.append('historical marker requires an unchanged submitted snapshot and no current-batch actions')
        # Stage contract §7: a submission found in the site's application history during resume is
        # recorded with its receipt even if this batch's company-order confirmation is still pending.
        site_reconciled = (role.get('stage') == 'submitted' and text(role.get('receipt_ref'))
                           and text(role.get('site_history_ref')))
        if form_started and not readonly_history and not site_reconciled:
            if (not text(role.get('company_order_confirmation_ref'))
                    or role.get('company_order_report_ref') != role.get('pre_form_report_ref')
                    or not isin(role.get('company_order_decision'), {'unchanged', 'changed'})):
                errors.append('company order must be confirmed using the same pre-form report before actions')
            if role.get('company_order_decision') == 'changed' and not text(role.get('company_role_order_raw')):
                errors.append('changed company order needs user-provided raw order')
        if role.get('stage') == 'uncertain' and not form_started:
            errors.append('uncertain stage requires actual attempted-action evidence')
        if role.get('cross_axis_conflict') is True and (form_started or role.get('selected') is True) and (role.get('selected') is not True or not text(role.get('selection_ref'))):
            errors.append('cross-axis choice needs explicit user selection')
        if role.get('score_includes_preferences') is True or role.get('selected_by_top5') is True:
            errors.append('capability score/Top5 cannot decide preferences')
    if prior_roles is None or not isinstance(prior_roles, list):
        errors.append('prior_roles must be a list (empty only for no prior records)')
        prior_roles = []
    for prior in prior_roles:
        if not isinstance(prior, dict) or not text(prior.get('role_key')):
            errors.append('prior role must have a stable role_key')
            continue
        after = current.get(prior['role_key'], {})
        if text(after.get('change_authorization_ref')):
            continue
        if prior.get('stage') == 'submitted' and (after.get('stage') != 'submitted' or after.get('receipt_ref') != prior.get('receipt_ref')):
            errors.append('preference update must preserve submitted role and receipt')
        if prior.get('selected') is True and (after.get('selected') is not True or isin(after.get('disposition'), {'pending', 'excluded'})):
            errors.append('preference update must preserve explicit selection')
    return errors
