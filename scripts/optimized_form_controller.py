"""Owned mock adapter for the shipping preparation loop, not a production submit executor."""
import json
from pathlib import Path
import fill_plan
import playwright_fill
from compile_form_mapping import compile_plan
from fixtures.form_sites import PROFILE, SITES
from form_test_support import scan, map_form
from form_preparation import prepare_automatic, DocumentBundle, diagnostic_allowed
from rea_bridge import script_excerpts
from full_chain_mcp import Controller, PROFILE_KEYS, schema


class OptimizedController(Controller):
    def __init__(self, *args):
        super().__init__(*args)
        self.documents = DocumentBundle(super().document)
        self.ui_attempts, self.binding_failures, self.diagnosed = {}, {}, set()
        self.bootstrapped = False
        self.preparation_passes = {}

    def gate(self, stage, site=None):
        try:
            result = super().gate(stage, site)
        except ValueError:
            self.event(kind='stage_gate', stage=stage, site=site, allowed=False)
            raise
        self.event(kind='stage_gate', stage=stage, site=site, allowed=True)
        return result

    def bootstrap(self):
        paths = ['SKILL.md', 'batch-contract', 'synthetic-profile', 'references/stage-contract.md',
                 'references/browser-application.md', 'skills/application-content-fill/SKILL.md',
                 'skills/privacy-info-fill/SKILL.md', 'references/semantic-form-automation.md']
        bundle = [self.documents.get(p) for p in paths]
        self.bootstrapped = True
        return {'documents': bundle, 'sites': SITES,
                'contract': 'Documents above are complete and loaded once. prepare_forms batches native preparation and upload rescans. '
                'Only remaining exceptions need model choices. inspect_widgets groups actual UI exploration across sites. '
                'complete_fields batches exception recipes. Review/Submit gates and every readback remain mandatory. '
                'review_submit_batch serially performs the same mock review/submit/receipt/Excel checks. '
                'REA only after an actual UI attempt leaves unresolved binding or an observed binding failure; successful widgets need no REA.'}

    def document(self, path):
        return self.documents.get(path)

    def current_verified(self, site, match):
        p = self.pages[site]
        c = next(c for c in self.inventories[site]['fields'] if c['index'] == match['index'])
        candidates = [f for f in self.plans[site]['字段'] if f['标签'] == match['label']
                      and f.get('值来源') == match['source'] and f['状态'] == '已读回'
                      and (f['定位'] == match['locator'] or f['定位'].get('css') == (c.get('controlLocator') or c['locator']))]
        if len(candidates) != 1:
            return False
        field = candidates[0]
        value = str(self.resume) if field['控件'] == '上传' else self.profile.get(match['source'].split(':', 1)[1])
        ok, _ = playwright_fill.poll(p, field, value, 300)
        return ok

    def preparation_state(self, site):
        inventory = self.inventories[site]
        mapping = self.mappings[site]
        pending = [f for f in mapping['fields'] if not self.current_verified(site, f)]
        p = self.pages[site]
        ui = p.evaluate('''() => [...document.querySelectorAll('button,[role="option"],[role="combobox"]')]
           .filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none')
           .map(e=>({role:e.getAttribute('role')||'button',text:(e.textContent||'').trim().slice(0,120),css:e.id?'#'+CSS.escape(e.id):null}))''')
        return {'site': site, 'ready_for_review': bool(mapping['fields']) and not pending and not self.binding_failures.get(site), 'verified_fields': len(mapping['fields']) - len(pending),
                'exceptions': [dict(f, control=next(c for c in inventory['fields'] if c['index'] == f['index'])) for f in pending],
                'visible_ui': ui if pending else [], 'binding_failure': self.binding_failures.get(site),
                'rea_eligible': diagnostic_allowed(pending, self.ui_attempts.get(site, 0), self.binding_failures.get(site))}

    @staticmethod
    def batch_sites(sites):
        if not sites or len(sites) != len(set(sites)) or any(s not in SITES for s in sites):
            raise ValueError('Use a nonempty unique list of owned site IDs')

    def prepare_forms(self, sites):
        if not self.bootstrapped:
            raise ValueError('Load bootstrap instructions and approved batch/profile before form actions')
        self.batch_sites(sites)
        results = []
        for site in sites:
            p = self.page(site)
            def capture():
                inventory = scan(p)
                mapped = map_form(inventory, p.url)['mapping']
                compiled = compile_plan(inventory, mapped, self.w.batch, self.companies[site], p.url, 'Playwright')
                self.inventories[site], self.mappings[site] = inventory, mapped
                if site not in self.plans or not any(f['状态'] == '已读回' for f in self.plans[site]['字段']):
                    self.plans[site] = compiled
                return mapped
            def apply(work):
                sources = {v: k for k, v in PROFILE_KEYS.items()}
                fields = [{'index': f['index'], 'source': 'resume' if f['semantic'] == 'resume'
                           else sources[f['source'].split(':', 1)[1]]} for f in work]
                return super(OptimizedController, self).configure_fill(site, fields)
            try:
                prepared = prepare_automatic(capture, lambda f: self.current_verified(site, f), apply)
                self.preparation_passes[site] = prepared['passes']
                self.binding_failures.pop(site, None)
                result = self.preparation_state(site)
                result.update({'passes': prepared['passes'], 'skipped_current_readbacks': prepared['skipped_current_readbacks']})
                results.append(result)
            except (ValueError, playwright_fill.Refused) as exc:
                self.binding_failures[site] = str(exc)
                results.append(self.preparation_state(site))
        return {'forms': results, 'instruction': 'Only exceptions need model recipes. Do not refill successful automatic fields. Batch UI inspections/exception completion across independent sites.'}

    def inspect_widgets(self, groups):
        sites = [g['site'] for g in groups]; self.batch_sites(sites)
        results = []
        for g in groups:
            site = g['site']; p = self.page(site)
            if site not in self.inventories:
                raise ValueError('Prepare the form first')
            if not self.preparation_state(site)['exceptions']:
                raise ValueError('Form is already verified; no duplicate exploration needed')
            for loc in g['clicks']:
                errors = fill_plan.locator_errors(loc, 'Widget click')
                if errors:
                    raise ValueError('; '.join(errors))
            playwright_fill.run_steps(p, [{'点击': loc} for loc in g['clicks']], 3000)
            self.ui_attempts[site] = self.ui_attempts.get(site, 0) + 1
            # Menu opening cannot invalidate field identities; capture actual options, preserving readbacks.
            inventory = scan(p); self.inventories[site] = inventory
            self.mappings[site] = map_form(inventory, p.url)['mapping']
            results.append(self.preparation_state(site))
        return {'forms': results}

    def complete_fields(self, groups):
        sites = [g['site'] for g in groups]; self.batch_sites(sites)
        results = []
        for g in groups:
            site = g['site']; p = self.page(site)
            for spec in g['fields']:
                match = next((f for f in self.mappings[site]['fields'] if f['index'] == spec['index']), None)
                if match is None or self.current_verified(site, match):
                    raise ValueError('Only current unresolved fields can be configured; automatic readbacks are already complete')
            try:
                super().configure_fill(site, g['fields'])
                self.binding_failures.pop(site, None)
            except (ValueError, playwright_fill.Refused) as exc:
                self.binding_failures[site] = str(exc)
            results.append(self.preparation_state(site))
        return {'forms': results}

    def diagnose_bindings(self, site, reason):
        state = self.preparation_state(site)
        if not reason.strip() or not state['rea_eligible']:
            raise ValueError('REA requires a remaining exception plus an actual UI attempt or binding failure')
        if site in self.diagnosed:
            raise ValueError('REA evidence already captured for this state; inspect retained evidence instead of recapturing')
        # Reuse the exact bounded REA bridge, retaining its complete raw evidence privately.
        mode = self.mode
        try:
            self.mode = 'enhanced'
            evidence = super().rea(site)
        finally:
            self.mode = mode
        self.diagnosed.add(site)
        terms = [v for f in state['exceptions'] for loc in (f.get('locator', {}), {'css': f['control'].get('controlLocator', '')}) for v in loc.values() if isinstance(v, str)]
        scripts = script_excerpts(evidence['captured_script_sources'], terms)
        return {'evidence_id': evidence['summary']['evidence_id'], 'artifact_sha256': evidence['summary']['artifact_sha256'],
                'completeness': evidence['summary']['completeness'], 'timing': evidence['summary']['timing'], 'excerpts': scripts,
                'instruction': 'Diagnose only these unresolved controls; execute actual UI clicks, never internal APIs or JS mutation.'}

    def read_diagnostic_evidence(self, site, sha256, start_line, max_lines):
        if site not in self.diagnosed or not 1 <= max_lines <= 40 or start_line < 1:
            raise ValueError('Read a bounded range of previously captured owned evidence')
        evidence = json.loads((self.root / ('rea-' + site + '.json')).read_bytes())
        for script in evidence['normalized_result']['scripts']['items']:
            artifact = script.get('source', {}).get('artifact', {})
            if artifact.get('sha256') == sha256:
                lines = artifact['text'].splitlines()
                selected = lines[start_line - 1:start_line - 1 + max_lines]
                text = '\n'.join(selected)
                return {'sha256': sha256, 'start_line': start_line, 'text': text[:6000],
                        'partial_range': len(text) > 6000, 'total_lines': len(lines)}
        raise ValueError('Unknown source hash in this owned capture')

    def review_submit_batch(self, sites):
        self.batch_sites(sites)
        results = {}
        for site in sites:
            if site in self.receipts:
                results[site] = {**self.receipts[site], 'already_verified': True}
                continue
            if not self.preparation_state(site)['ready_for_review']:
                raise ValueError('Unresolved fields block review/submission: ' + site)
            result = super().review_submit(site)
            results[site] = result
            if not result.get('server_verified'):
                self.binding_failures[site] = 'Server draft rejected component binding'
                for field in self.plans[site]['字段']:
                    field['状态'] = '待填'
                    field['备注'] = 'Server draft rejected binding; reprepare and inspect before any submission'
                break  # no blind final-submit retry; remaining independent sites may be submitted later
        return {'sites': results}

    def dispatch(self, name, data):
        methods = {'bootstrap': self.bootstrap, 'read_reference': self.document, 'prepare_forms': self.prepare_forms,
                   'inspect_widgets': self.inspect_widgets, 'complete_fields': self.complete_fields,
                   'diagnose_bindings': self.diagnose_bindings, 'review_submit_batch': self.review_submit_batch,
                   'read_diagnostic_evidence': self.read_diagnostic_evidence,
                   'finish_batch': self.finish}
        return methods[name](**data)

    def finish(self):
        result = super().finish()
        result['preparation_passes'] = self.preparation_passes
        result['loaded_documents'] = self.documents.loaded
        (self.root / 'verified-batch.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        return result


def optimized_tools():
    site = {'type': 'string', 'enum': SITES}
    sites = {'type': 'array', 'items': site, 'minItems': 1, 'uniqueItems': True}
    locator = {'type': 'object', 'properties': {
        'css': {'type': 'string'}, 'label': {'type': 'string'}, 'role': {'type': 'string'},
        'name': {'type': 'string'}, 'text': {'type': 'string'}, 'placeholder': {'type': 'string'},
        'exact': {'type': 'boolean'}, 'nth': {'type': 'integer', 'minimum': 0}}, 'additionalProperties': False,
        'oneOf': [{'required': [key]} for key in ('css', 'label', 'role', 'text', 'placeholder')]}
    locator['allOf'] = [{'if': {'required': ['role']}, 'then': {'required': ['name']}}]
    clicks = {'type': 'array', 'items': locator, 'minItems': 1}
    field = schema({'index': {'type': 'integer'}, 'source': {'type': 'string', 'enum': list(PROFILE) + ['resume']},
                    'clicks': clicks, 'readback': locator}, ['index', 'source'])
    groups = lambda props, req: {'type': 'array', 'minItems': 1, 'items': schema({'site': site, **props}, ['site', *req])}
    definitions = [
        ('bootstrap', 'Start once: load complete Skill, required references and approved synthetic profile/batch together, with document hashes. Do not reread this bundle.', schema({}, [])),
        ('read_reference', 'Read an additional staged Markdown reference only when needed. Already-loaded documents return hash acknowledgment, not duplicate text.', schema({'path': {'type': 'string'}}, ['path'])),
        ('prepare_forms', 'Batch observe/map/native-fill/readback for owned sites, including upload-first and bounded rescans. Returns only unresolved fields. Never saves, approves or submits.', schema({'sites': sites}, ['sites'])),
        ('inspect_widgets', 'Batch actual guarded clicks to open unresolved widgets/advance menus, return visible options and current exceptions. No save or final submission.', schema({'groups': groups({'clicks': clicks}, ['clicks'])}, ['groups'])),
        ('complete_fields', 'Batch model-selected real UI recipes for unresolved fields only. Successful automatic fields cannot be refilled. Every field is read back.', schema({'groups': groups({'fields': {'type': 'array', 'items': field, 'minItems': 1}}, ['fields'])}, ['groups'])),
        ('diagnose_bindings', 'Optional actual REA capture only for unresolved binding after attempted real UI exploration or observed failure. No routine capture of successful controls.', schema({'site': site, 'reason': {'type': 'string', 'minLength': 1}}, ['site', 'reason'])),
        ('read_diagnostic_evidence', 'Read a bounded line range from a previously captured owned script when the initial diagnostic excerpt is insufficient.', schema({'site': site, 'sha256': {'type': 'string'}, 'start_line': {'type': 'integer', 'minimum': 1}, 'max_lines': {'type': 'integer', 'minimum': 1, 'maximum': 40}}, ['site', 'sha256', 'start_line', 'max_lines'])),
        ('review_submit_batch', 'Serial mock-only save/server-draft/UI recheck, versioned review, simulated exact user approval, real Review/Submit gates, actual UI submission, server receipt and Excel readback per site.', schema({'sites': sites}, ['sites'])),
        ('finish_batch', 'Only after all five server receipts/Excel readbacks. Run the same actual closeout gate.', schema({}, [])),
    ]
    return [{'name': n, 'description': d, 'inputSchema': s} for n, d, s in definitions]
