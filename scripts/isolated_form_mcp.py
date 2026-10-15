"""Single-site owned mock adapter for cold/warm real-model measurements.

Loads the selected immutable executor runtime. Warm seeding uses automatic native inputs
and current readbacks only, never fixture widget recipes, draft saving, approval or submission.
The model receives a fresh page/plan. Full CLI wall time includes the separately timed seed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time


def configure(args):
    sys.path.insert(0, str(args.runtime / 'scripts'))
    import full_chain_mcp as engine
    from fixtures.form_sites import SITES as allowed
    if args.site not in allowed or args.mode not in ('baseline', 'optimized'):
        raise ValueError('Select an owned site and supported mode')
    engine.SITES = [args.site]  # Process-local experiment scope, never mutate fixture/server manifest.
    from form_test_support import scan, map_form
    from compile_form_mapping import compile_plan
    from form_preparation import prepare_automatic
    import playwright_fill

    class ScopeMixin:
        def __init__(self, *values):
            self.benchmark_phase = 'application_setup'
            self.seed_cache = None
            self.cache_observations = []
            self.cache_seed = {'state': args.cache_state, 'seconds': 0.0, 'available': False,
                               'application_consumed': False, 'verified_automatic_fields': 0,
                               'seed_model_calls': 0, 'reused_filled_plan': False}
            super().__init__(*values)
            if args.cache_state == 'warm':
                self.seed_verified_cache()
            self.benchmark_phase = 'application'

        def event(self, **data):
            super().event(benchmark_phase=self.benchmark_phase, **data)

        def gate(self, stage, site=None):
            try:
                result = super().gate(stage, site)
            except ValueError:
                if args.mode == 'baseline':
                    self.event(kind='stage_gate', stage=stage, site=site, allowed=False)
                raise
            if args.mode == 'baseline':
                self.event(kind='stage_gate', stage=stage, site=site, allowed=True)
            return result

        def seed_verified_cache(self):
            self.benchmark_phase = 'cache_seed'
            started = time.perf_counter()
            wall = time.time_ns()
            site = args.site
            page = self.page(site)

            def current_verified(field):
                matches = [f for f in self.plans[site]['字段'] if f['状态'] == '已读回'
                           and f['标签'] == field['label'] and f.get('值来源') == field['source']]
                if len(matches) != 1:
                    return False
                f = matches[0]
                value = str(self.resume) if f['控件'] == '上传' else self.profile.get(field['source'].split(':', 1)[1])
                return playwright_fill.poll(page, f, value, 500)[0]

            def capture():
                inventory = scan(page)
                mapping = map_form(inventory, page.url)['mapping']
                self.inventories[site], self.mappings[site] = inventory, mapping
                if site not in self.plans or not any(f['状态'] == '已读回' for f in self.plans[site]['字段']):
                    self.plans[site] = compile_plan(inventory, mapping, self.w.batch, self.companies[site], page.url, 'Playwright')
                return mapping

            def apply(fields):
                sources = {v: k for k, v in engine.PROFILE_KEYS.items()}
                specs = [{'index': f['index'], 'source': 'resume' if f['semantic'] == 'resume'
                          else sources[f['source'].split(':', 1)[1]]} for f in fields]
                # The unchanged original executor performs actual native input/readback.
                return original_controller.configure_fill(self, site, specs)

            prepare_automatic(capture, current_verified, apply)
            mapping = self.mappings[site]
            automatic = [f for f in mapping['fields'] if f['disposition'] == 'automatic']
            verified = [f['index'] for f in automatic if current_verified(f)]
            if len(verified) != len(automatic) or not verified:
                raise ValueError('Warm cache requires current automatic-field readbacks')
            cache = map_form(self.inventories[site], page.url, verified_indexes=verified)['cache']
            path = self.root / 'verified-semantic-cache.json'
            path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
            self.seed_cache = cache
            page.close()
            for values in (self.pages, self.inventories, self.plans, self.mappings):
                values.pop(site, None)
            plan_path = self.w.role_folder(self.companies[site], self.base + '/forms/' + site) / '填写方案.json'
            if plan_path.exists():
                plan_path.unlink()  # Only this owned seed's plan; no prior filled state survives.
            self.cache_seed.update(seconds=time.perf_counter() - started, available=True,
                                   verified_automatic_fields=len(verified), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                   fingerprint=cache['fingerprint'], seed_page_closed=True)
            self.event(kind='cache_seed_completed', site=site, start_wall_ns=wall, **self.cache_seed)

        def finish(self):
            result = super().finish()
            self.cache_seed['application_consumed'] = any(x['cache_hit'] for x in self.cache_observations)
            result['isolated_case'] = {'site': args.site, 'cache': self.cache_seed,
                                       'cache_observations': self.cache_observations}
            (self.root / 'verified-batch.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            return result

    original_controller = engine.Controller
    if args.mode == 'baseline':
        class ScopedController(ScopeMixin, original_controller):
            pass
        engine.Controller = ScopedController
    else:
        import optimized_form_controller as optimized
        optimized.SITES = [args.site]
        original_mapping = optimized.map_form

        def mapping_with_cache(inventory, url, *values, **kwargs):
            controller = current_controller[0]
            if controller is not None:
                kwargs['cache'] = controller.seed_cache
            result = original_mapping(inventory, url, *values, **kwargs)
            if controller is not None and controller.benchmark_phase == 'application':
                observation = {'cache_hit': result['mapping']['cacheHit'], 'fingerprint': result['mapping']['fingerprint']}
                controller.cache_observations.append(observation)
                controller.event(kind='semantic_cache_observed', site=args.site, **observation)
            return result

        current_controller = [None]
        class ScopedController(ScopeMixin, optimized.OptimizedController):
            def __init__(self, *values):
                super().__init__(*values)
                current_controller[0] = self
        optimized.OptimizedController = ScopedController
        optimized.map_form = mapping_with_cache

    original_tools = engine.tools_for
    def scoped_tools(mode):
        tools = original_tools(mode)
        for tool in tools:
            if tool['name'] == 'finish_batch':
                tool['description'] = 'Verify the one scoped site receipt and workbook, then run the real closeout gate.'
        return tools
    engine.tools_for = scoped_tools
    return engine, ScopedController


def self_test(args, controller_class):
    import fill_plan
    from form_test_support import map_form
    c = controller_class(args.mode, args.root, args.docs, args.rea_entry)
    try:
        site = args.site
        assert set(c.companies) == {site} and not c.plans and not c.pages
        if args.mode == 'optimized':
            c.bootstrap()
            state = c.prepare_forms([site])['forms'][0]
            if site == 'date-cascade':
                assert len(state['exceptions']) == 2 and not state['ready_for_review']
                try:
                    c.review_submit_batch([site])
                    raise AssertionError('Unresolved fields were submitted')
                except ValueError:
                    pass
                assert not c.receipts
                return
            assert state['ready_for_review']
            assert all(f['状态'] == '已读回' for f in c.plans[site]['字段'])
            if site == 'upload-rerender':
                assert c.preparation_passes[site] == 2
            c.review_submit_batch([site])
        else:
            # Fixture-only offline source selection. Never present in a model prompt/tool output.
            c.observe(site)
            mapping = map_form(c.inventories[site], c.pages[site].url)['mapping']
            sources = {v: k for k, v in __import__('full_chain_mcp').PROFILE_KEYS.items()}
            c.configure_fill(site, [{'index': f['index'], 'source': sources[f['source'].split(':', 1)[1]]} for f in mapping['fields']])
            c.review_submit(site)
        result = c.finish()
        assert set(result['sites']) == {site} and result['closeout_gate'] and result['rea_calls'] == 0
        assert (result['isolated_case']['cache']['application_consumed'] is True) == (args.mode == 'optimized' and args.cache_state == 'warm')
        plan = next((c.root / 'workspace').rglob('填写方案.json'))
        assert not fill_plan.validate(json.loads(plan.read_bytes()))
        print(json.dumps({'passed': True, 'site': site, 'mode': args.mode, 'cache_state': args.cache_state}))
    finally:
        c.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--mode', choices=['baseline', 'optimized'], required=True)
    p.add_argument('--site', required=True)
    p.add_argument('--cache-state', choices=['cold', 'warm'], required=True)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--docs', type=Path, required=True)
    p.add_argument('--rea-entry', type=Path, required=True)
    p.add_argument('--self-test', action='store_true')
    args = p.parse_args()
    engine, controller_class = configure(args)
    if args.self_test:
        self_test(args, controller_class)
    else:
        engine.run_server(args)
