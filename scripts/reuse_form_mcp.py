"""Owned single-site experiment adapter; production rule lifecycle is rea_rule_store.py.

The only inherited state in reuse mode is a verified value-free rule file. No old
model messages, filled plans, pages, approvals or receipts are loaded.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path


def configure(args):
    sys.path.insert(0, str(args.runtime / 'scripts'))
    import full_chain_mcp as engine
    import optimized_form_controller as optimized
    import fixtures.form_sites as fixture
    from form_test_support import scan, map_form
    from compile_form_mapping import compile_plan
    import playwright_fill
    from rea_rule_store import RuleStore, resolve_recipe, digest

    if args.site not in fixture.SITES:
        raise ValueError('Unknown owned mock site')
    engine.SITES = optimized.SITES = [args.site]
    # Explicit synthetic test variation; server oracle and rendered UI both change.
    # No recipes or EXPECTED manifest are provided to the model or rule compiler.
    old_profile = dict(fixture.PROFILE)
    if args.variant:
        fixture.PROFILE.update(name='复用候选人', phone='11111111111', email='reuse@example.test',
            **{'bachelor.school': '复用本科大学', 'master.school': '复用硕士大学',
               'graduation': '2027-07', 'project': '复用项目：采用当前资料，验证规则复用与逐字段读回。'})
    original_html = fixture.page_html
    def html(site, generation):
        # DOM generations differ even between fresh processes; persisted CSS is forbidden.
        text = original_html(site, generation + (100 if args.variant else 0))
        for key in ('bachelor.school', 'master.school', 'graduation'):
            text = text.replace(old_profile[key], fixture.PROFILE[key])
        return text
    fixture.page_html = html

    class ReuseController(optimized.OptimizedController):
        def __init__(self, *values):
            self.analysis = None
            self.experiment = args.experiment
            self.rule_store = RuleStore(args.rule_dir)
            # Test-only explicit logical deployment alias: random loopback ports are not
            # portable production origins. Production callers must use form_scope(URL).
            self.rule_scope = 'owned-mock://forms/' + args.site
            self.rule_hit, self.rule_applied, self.learned = None, False, None
            self.recipes, self.explorations = {}, {}
            self.replay_validation = False
            self.benchmark_phase = 'application'
            super().__init__(*values)

        def event(self, **data):
            super().event(benchmark_phase='application', **data)

        def bootstrap(self):
            result = super().bootstrap()
            result['documents'].append(self.documents.get('references/rea-rule-reuse.md'))
            result['experiment'] = args.experiment
            result['contract'] += (' For this FIRST-LEARNING experiment only, call analyze_form before prepare_forms, '
                'even on a native form. This measures learning cost, not a production requirement.' if args.experiment == 'first-rea' else '')
            result['contract'] += (' Reuse loads only a previous verified rule; prepare_forms attempts real current-value replay, '
                'with current readback and fallback on mismatch.' if args.experiment == 'reuse' else '')
            return result

        def analyze_form(self, site):
            if self.experiment == 'no-rea':
                raise ValueError('REA is disabled in this arm')
            if self.analysis:
                return {'already_captured': True, 'sha256': self.analysis['sha256']}
            p = self.page(site)
            inventory = scan(p)
            self.inventories[site] = inventory
            self.mappings[site] = map_form(inventory, p.url)['mapping']
            previous = self.mode
            try:
                self.mode = 'enhanced'
                evidence = engine.Controller.rea(self, site)
            finally:
                self.mode = previous
            raw = self.root / ('rea-' + site + '.json')
            summary = evidence['summary']
            if summary['completeness']['truncated_sections']:
                raise ValueError('Truncated REA cannot support a learned rule')
            self.analysis = {'sha256': hashlib.sha256(raw.read_bytes()).hexdigest(), 'truncated': False,
                             'operation': 'inspect_web_page'}
            self.diagnosed.add(site)
            self.event(kind='rea_learning_capture', site=site, evidence=self.analysis, timing=summary['timing'])
            terms = [c.get('controlLocator') or c.get('locator', '') for c in inventory['fields']]
            return {'evidence': self.analysis, 'timing': summary['timing'],
                    'excerpts': optimized.script_excerpts(evidence['captured_script_sources'], terms, budget=6000),
                    'instruction': 'Interpret actual captured bindings. Use visible UI, never internal APIs. '
                    'For each exception supply a complete click path from its closed initial state; '
                    'all recipes are replayed on a fresh page before saving any verified rule.'}

        def diagnose_bindings(self, site, reason):
            if not self.preparation_state(site)['rea_eligible']:
                raise ValueError('No unresolved binding after UI attempt/failure')
            return self.analyze_form(site)

        def portable(self, site, field, loc):
            p = self.pages[site]
            target = playwright_fill.locate(p, loc)
            if loc.get('role'):
                target = p.get_by_role(loc['role'], name=loc.get('name'), exact=loc.get('exact', True), include_hidden=True)
            if target.count() != 1:
                raise ValueError('Learning requires a unique real element')
            c, = [c for c in self.inventories[site]['fields'] if c['index'] == field['index']]
            for key, name in (('controlLocator', 'control'), ('locator', 'wrapper')):
                if c.get(key) and target.evaluate('(e,s)=>e===document.querySelector(s)', c[key]):
                    return {'target': name}
            info = target.evaluate('''e=>({role:e.getAttribute('role')||(e.tagName==='BUTTON'?'button':null),
                text:(e.textContent||'').trim(),inForm:!!e.closest('form')})''')
            if not info['inForm'] or not info['role']:
                raise ValueError('A portable field option needs a real named role inside this form')
            name = info['text']
            # Never persist the learned applicant's selected option as a fixed answer.
            if name == fixture.PROFILE.get(field['semantic']):
                name = {'value_source': field['semantic']}
            return {'role': info['role'], 'name': name}

        def inspect_widgets(self, groups):
            if self.experiment != 'first-rea':
                return super().inspect_widgets(groups)
            for group in groups:
                site = group['site']
                for loc in group['clicks']:
                    target = playwright_fill.locate(self.pages[site], loc)
                    for f in self.mappings[site]['fields']:
                        c = next(c for c in self.inventories[site]['fields'] if c['index'] == f['index'])
                        if target.count() == 1 and target.evaluate('(e,s)=>document.querySelector(s)?.contains(e)||false', c['locator']):
                            self.explorations.setdefault(f['semantic'], []).append(self.portable(site, f, loc))
            return super().inspect_widgets(groups)

        def complete_fields(self, groups):
            if self.experiment != 'first-rea':
                return super().complete_fields(groups)
            pending = {}
            for group in groups:
                site = group['site']
                for spec in group['fields']:
                    f = next(f for f in self.mappings[site]['fields'] if f['index'] == spec['index'])
                    steps = [self.portable(site, f, x) for x in spec.get('clicks', [])]
                    if steps and steps[0] not in ({'target': 'wrapper'}, {'target': 'control'}):
                        steps = self.explorations.get(f['semantic'], []) + steps
                    pending[f['semantic']] = {'source': spec['source'], 'steps': steps, 'readback': 'current-control'}
            result = super().complete_fields(groups)
            if not any(f['binding_failure'] for f in result['forms']):
                self.recipes.update(pending)
            return result

        def capture_current(self, site):
            p = self.page(site)
            inventory = scan(p); mapping = map_form(inventory, p.url)['mapping']
            self.inventories[site], self.mappings[site] = inventory, mapping
            if site not in self.plans:
                self.plans[site] = compile_plan(inventory, mapping, self.w.batch, self.companies[site], p.url, 'Playwright')
            return inventory, mapping

        def replay(self, site, rule):
            for generation in range(3):
                inventory, mapping = self.capture_current(site)
                if self.rule_store.load(self.rule_scope, inventory, mapping) is None and rule.get('state') == 'verified':
                    raise ValueError('Rule no longer matches current structure')
                work = list(zip(mapping['fields'], rule['recipes']))
                work.sort(key=lambda pair: pair[1]['source'] != 'resume')
                for field, recipe in work:
                    if self.current_verified(site, field):
                        continue
                    c = next(c for c in inventory['fields'] if c['index'] == field['index'])
                    spec = resolve_recipe(recipe, c, fixture.PROFILE)
                    # Same original input primitive and mandatory current readback as other arms.
                    applied = engine.Controller.configure_fill(self, site, [spec])
                    self.event(kind='rule_field_applied', site=site, semantic=field['semantic'],
                               generation=generation, current_readback=True, validation=self.replay_validation)
                    if applied.get('requires_rescan'):
                        break
                else:
                    self.binding_failures.pop(site, None)
                    if not self.preparation_state(site)['ready_for_review']:
                        raise ValueError('Rule did not verify all current fields')
                    return
            raise ValueError('Rule replay exceeded DOM rescan budget')

        def prepare_forms(self, sites):
            if not self.bootstrapped:
                raise ValueError('Bootstrap before any form actions')
            if self.experiment == 'first-rea' and not self.analysis:
                raise ValueError('First-learning experiment requires analyze_form before filling')
            if self.experiment == 'reuse' and not self.rule_applied:
                self.batch_sites(sites)
                site, = sites
                inventory, mapping = self.capture_current(site)
                self.rule_hit = self.rule_store.load(self.rule_scope, inventory, mapping)
                if self.rule_hit:
                    self.event(kind='rule_hit', site=site, rule_sha256=self.rule_hit['integrity_sha256'],
                               evidence_sha256=self.rule_hit['evidence']['sha256'])
                    try:
                        self.replay(site, self.rule_hit)
                        self.rule_applied = True
                        self.event(kind='rule_reused', site=site, rule_sha256=self.rule_hit['integrity_sha256'])
                        return {'forms': [self.preparation_state(site)], 'rule_reused': True}
                    except Exception as exc:
                        self.rule_store.invalidate(self.rule_scope, str(exc))
                        self.binding_failures[site] = str(exc)
                        self.event(kind='rule_invalidated', site=site, reason=str(exc))
                else:
                    self.event(kind='rule_miss', site=site)
            return super().prepare_forms(sites)

        def learn_candidate(self, site):
            inventory, mapping = self.capture_current(site)
            recipes = []
            for f in mapping['fields']:
                recipe = self.recipes.get(f['semantic'])
                if recipe is None:
                    if f['disposition'] != 'automatic':
                        raise ValueError('Missing complete exception recipe; supply full closed-state path')
                    recipe = {'source': f['semantic'], 'steps': [], 'readback': 'current-control'}
                recipes.append(recipe)
            return self.rule_store.candidate(self.rule_scope, inventory, mapping, recipes, self.analysis)

        def gate(self, stage, site=None):
            if stage == 'review' and getattr(self, 'pending_candidate', None):
                candidate = self.pending_candidate
                def verify():
                    state = self.preparation_state(site)
                    persisted = self.pages[site].request.get(self.base + '/api/draft/' + site).json()
                    actual = {r['source']: ('synthetic-resume.pdf' if r['source'] == 'resume' else fixture.PROFILE[r['source']]) for r in candidate['recipes']}
                    return {'current_readbacks': state['verified_fields'] if state['ready_for_review'] else 0,
                            'server_draft_matched': actual == persisted}
                self.learned = self.rule_store.promote(candidate, verify)
                self.pending_candidate = None
                self.event(kind='rule_promoted', site=site, rule_sha256=self.learned['integrity_sha256'],
                           evidence_sha256=self.analysis['sha256'], fresh_page_replay=True)
            return super().gate(stage, site)

        def review_submit_batch(self, sites):
            if self.experiment == 'first-rea' and self.learned is None:
                site, = sites
                if not self.preparation_state(site)['ready_for_review']:
                    raise ValueError('All fields must be currently read back before learning')
                candidate = self.learn_candidate(site)
                # Validate the ENTIRE recipe from a fresh blank page, not the exploratory
                # partially-open menu. This cost is included in the learning arm.
                self.pages[site].close()
                for values in (self.pages, self.inventories, self.mappings, self.plans):
                    values.pop(site, None)
                self.replay_validation = True
                try:
                    self.replay(site, candidate)
                finally:
                    self.replay_validation = False
                self.pending_candidate = candidate
            result = super().review_submit_batch(sites)
            if any(not r.get('server_verified') for r in result['sites'].values()):
                self.rule_store.invalidate(self.rule_scope, 'Server draft binding rejected')
                self.event(kind='rule_invalidated', site=sites[0], reason='Server draft binding rejected')
            return result

        def dispatch(self, name, data):
            return self.analyze_form(**data) if name == 'analyze_form' else super().dispatch(name, data)

        def finish(self):
            result = super().finish()
            if self.experiment == 'first-rea' and not self.learned:
                raise ValueError('First analysis did not produce a verified rule')
            result['rule_experiment'] = {'arm': self.experiment, 'variant': args.variant,
                'rule_reused': self.rule_applied,
                'learned_rule_sha256': self.learned['integrity_sha256'] if self.learned else None,
                'consumed_rule_sha256': self.rule_hit['integrity_sha256'] if self.rule_applied else None,
                'source_evidence_sha256': (self.learned or self.rule_hit or {}).get('evidence', {}).get('sha256')}
            (self.root / 'verified-batch.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            return result

    optimized.OptimizedController = ReuseController
    original_tools = engine.tools_for
    def tools(mode):
        result = original_tools(mode)
        if args.experiment == 'no-rea':
            result = [x for x in result if x['name'] not in ('diagnose_bindings', 'read_diagnostic_evidence')]
        else:
            result.append({'name': 'analyze_form', 'description': 'Actual REA passive analysis on this owned form; first-learning experiment before filling; never writes the application.',
                           'inputSchema': engine.schema({'site': {'type': 'string', 'enum': [args.site]}}, ['site'])})
        for t in result:
            if t['name'] == 'finish_batch':
                t['description'] = 'Verify the one scoped receipt/workbook and actual closeout gate.'
        return result
    engine.tools_for = tools
    return engine, ReuseController


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--mode', choices=['optimized'], required=True)
    p.add_argument('--experiment', choices=['no-rea', 'first-rea', 'reuse'], required=True)
    p.add_argument('--site', required=True)
    p.add_argument('--rule-dir', type=Path, required=True)
    p.add_argument('--variant', type=int, choices=[0, 1], default=0)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--docs', type=Path, required=True)
    p.add_argument('--rea-entry', type=Path, required=True)
    return p


if __name__ == '__main__':
    args = parser().parse_args()
    engine, _ = configure(args)
    engine.run_server(args)
