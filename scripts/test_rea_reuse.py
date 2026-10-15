"""Rule invariants and owned browser closed-loop tests. No paid model calls."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from rea_rule_store import RuleStore, resolve_recipe, form_scope, digest


class RuleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = RuleStore(self.temp.name)
        self.inventory = {'readOnly': True, 'valuesIncluded': False, 'count': 1,
            'fields': [{'index': 7, 'label': '学校', 'kind': 'select', 'required': True}]}
        self.mapping = {'fields': [{'index': 7, 'label': '学校', 'group': '本科', 'kind': 'select',
                                  'semantic': 'bachelor.school', 'source': '档案:学校-本科'}]}
        self.recipe = {'source': 'bachelor.school', 'steps': [{'target': 'wrapper'},
                       {'role': 'option', 'name': {'value_source': 'bachelor.school'}}], 'readback': 'current-control'}
        self.evidence = {'sha256': 'a' * 64, 'truncated': False}
        self.scope = form_scope('https://ats.example.test/apply?role=1')

    def candidate(self):
        return self.store.candidate(self.scope, self.inventory, self.mapping, [self.recipe], self.evidence)

    def promote(self):
        return self.store.promote(self.candidate(), lambda: {'current_readbacks': 1, 'server_draft_matched': True})

    def test_current_values_and_current_locators(self):
        self.promote()
        rule = self.store.load(self.scope, self.inventory, self.mapping)
        spec = resolve_recipe(rule['recipes'][0], {'index': 9, 'locator': '#fresh-wrapper', 'controlLocator': '#fresh-input'},
                              {'bachelor.school': '另一个大学'})
        self.assertEqual(spec['index'], 9)
        self.assertEqual(spec['clicks'][0], {'css': '#fresh-wrapper'})
        self.assertEqual(spec['clicks'][1]['name'], '另一个大学')
        self.assertNotIn('另一个大学', json.dumps(rule, ensure_ascii=False))

    def test_missing_or_partial_evidence_and_failed_verification_never_save(self):
        for evidence in ({}, {'sha256': 'a' * 64, 'truncated': True}):
            with self.assertRaises(ValueError):
                self.store.candidate(self.scope, self.inventory, self.mapping, [self.recipe], evidence)
        for verification in ({}, {'current_readbacks': 1, 'server_draft_matched': False}, {'current_readbacks': 0, 'server_draft_matched': True}):
            with self.assertRaises(ValueError): self.store.promote(self.candidate(), lambda: verification)
        self.assertFalse(self.store.path(self.scope).exists())

    def test_structure_change_invalidates_and_preserves_rejected_artifact(self):
        self.promote()
        changed = copy.deepcopy(self.mapping); changed['fields'][0]['group'] = '硕士'
        self.assertIsNone(self.store.load(self.scope, self.inventory, changed))
        self.assertTrue(list(Path(self.temp.name).glob('*.invalid-*.json')))

    def test_tamper_and_unknown_source_rejected(self):
        self.promote()
        path = self.store.path(self.scope)
        data = json.loads(path.read_bytes()); data['recipes'][0]['source'] = 'password'
        path.write_text(json.dumps(data), encoding='utf-8')
        self.assertIsNone(self.store.load(self.scope, self.inventory, self.mapping))
        self.recipe['source'] = 'master.school'
        with self.assertRaises(ValueError): self.candidate()

    def test_unsafe_steps_and_old_approval_never_enter_rules(self):
        for step in ({'css': '#stale'}, {'role': 'button', 'name': '提交申请'}, {'script': 'evil()'}):
            self.recipe['steps'] = [step]
            with self.assertRaises(ValueError): self.candidate()
        self.recipe['steps'] = []; self.recipe['approved'] = True
        with self.assertRaises(ValueError): self.candidate()

    def test_origin_scope_does_not_cross_domains(self):
        self.promote()
        self.assertIsNone(self.store.load(form_scope('https://other.example.test/apply'), self.inventory, self.mapping))
        with self.assertRaises(ValueError): form_scope('https://user:pass@ats.example.test/apply')

    def test_experiment_scope_and_learning_dependency(self):
        from reuse_form_benchmark import cells, prompt
        grid = cells()
        self.assertEqual(len(grid), 15)
        self.assertEqual(len({r['case_id'] for r in grid}), 15)
        for site in {r['site'] for r in grid}:
            arms = [r['arm'] for r in grid if r['site'] == site]
            self.assertLess(arms.index('first-rea'), arms.index('reuse'))
            for arm in arms:
                self.assertIn('ONLY ' + site, prompt(site, arm))
                self.assertIn('arm: ' + arm, prompt(site, arm))


def browser_arm(args):
    from reuse_form_mcp import configure
    from types import SimpleNamespace
    runtime = args.runtime
    ns = SimpleNamespace(runtime=runtime, mode='optimized', experiment=args.arm, site=args.site,
        root=args.root / args.arm, docs=runtime, rule_dir=args.root / 'rules',
        variant=1 if args.arm == 'reuse' else 0, rea_entry=args.rea_entry or Path('offline-unit-evidence-only'))
    engine, cls = configure(ns)
    c = cls('optimized', ns.root, runtime, ns.rea_entry)
    try:
        c.bootstrap()
        if args.fault == 'wrong-option':
            path, = (args.root / 'rules').glob('*.json')
            rule = json.loads(path.read_bytes())
            rule.pop('integrity_sha256')
            recipe = next(r for r in rule['recipes'] if r['source'] == 'bachelor.school')
            recipe['steps'][-1] = {'role': 'option', 'name': '不存在的学校'}
            rule['integrity_sha256'] = digest(rule)
            path.write_text(json.dumps(rule, ensure_ascii=False), encoding='utf-8')
        if args.arm == 'first-rea':
            if args.rea_entry:
                c.analyze_form(args.site)
            else:
                # This is an explicit offline lifecycle fixture, not reported real REA evidence.
                c.analysis = {'sha256': 'f' * 64, 'truncated': False, 'operation': 'offline-test-fixture'}
        result = c.prepare_forms([args.site])['forms'][0]
        if args.fault == 'wrong-option':
            assert not c.rule_applied and not result['ready_for_review']
            assert not c.rule_store.path(c.rule_scope).exists()
            try:
                c.review_submit_batch([args.site])
                raise AssertionError('Wrong rule submitted')
            except ValueError:
                pass
            assert not c.state['receipts']
            print('PASS wrong-option invalidates rule, falls back and blocks submit')
            return
        if args.arm != 'reuse':
            # Offline browser test recipes only; paid model never sees this source.
            from fixtures.form_sites import PROFILE
            specs = []
            for f in result['exceptions']:
                if f['semantic'] == 'bachelor.school':
                    steps = [{'css': '#school-widget'}, {'role': 'option', 'name': PROFILE['bachelor.school']}] if args.site == 'search-dropdown' else [
                        {'css': '#cascade'}, {'css': '#level-one'}, {'css': '#level-two'}]
                    readback = '#school-search' if args.site == 'search-dropdown' else '#school-readback'
                else:
                    steps = [{'css': '#graduation'}, {'css': '#date-cell'}]; readback = '#graduation'
                specs.append({'index': f['index'], 'source': f['semantic'], 'clicks': steps, 'readback': {'css': readback}})
            if specs:
                c.complete_fields([{'site': args.site, 'fields': specs}])
        if args.arm == 'reuse':
            assert c.rule_applied and c.rea_calls == 0
            # A correct cached rule never supplies mock user approval.
            try:
                c.gate('submit', args.site)
                raise AssertionError('Missing approval passed')
            except ValueError:
                pass
            if args.fault == 'stale-binding':
                from fixtures.form_sites import PROFILE
                c.pages[args.site].locator('#school-search').fill(PROFILE['bachelor.school'])
                rejected = c.review_submit_batch([args.site])
                assert not rejected['sites'][args.site].get('server_verified')
                assert not c.state['receipts'] and not c.rule_store.path(c.rule_scope).exists()
                assert not c.preparation_state(args.site)['ready_for_review']
                print('PASS current visible value with lost binding rejects draft and invalidates rule')
                return
        c.review_submit_batch([args.site])
        result = c.finish()
        assert len(c.state['receipts']) == 1 and result['closeout_gate']
        c.review_submit_batch([args.site])
        assert len(c.state['receipts']) == 1, 'Duplicate submission'
        if args.arm == 'first-rea': assert c.learned
        print(json.dumps({'passed': True, 'site': args.site, 'arm': args.arm, 'rea_calls': c.rea_calls}))
    finally:
        c.close()


def browser_all(args):
    from fixtures.form_sites import SITES
    import shutil
    with tempfile.TemporaryDirectory() as temp:
        for site in SITES:
            for arm in ('no-rea', 'first-rea', 'reuse'):
                command = [sys.executable, __file__, '--browser-arm', '--runtime', str(args.runtime),
                           '--root', str(Path(temp) / site), '--site', site, '--arm', arm]
                if args.rea_entry and arm == 'first-rea':
                    command += ['--rea-entry', str(args.rea_entry)]
                subprocess.run(command, check=True)
        for fault in ('wrong-option', 'stale-binding'):
            root = Path(temp) / ('fault-' + fault)
            shutil.copytree(Path(temp) / 'search-dropdown' / 'rules', root / 'rules')
            subprocess.run([sys.executable, __file__, '--browser-arm', '--runtime', str(args.runtime),
                           '--root', str(root), '--site', 'search-dropdown', '--arm', 'reuse', '--fault', fault], check=True)


if __name__ == '__main__':
    if any(a in sys.argv for a in ('--browser', '--browser-arm')):
        p = argparse.ArgumentParser()
        p.add_argument('--browser', action='store_true'); p.add_argument('--browser-arm', action='store_true')
        p.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parent.parent)
        p.add_argument('--rea-entry', type=Path); p.add_argument('--root', type=Path)
        p.add_argument('--site'); p.add_argument('--arm')
        p.add_argument('--fault', choices=['wrong-option', 'stale-binding'])
        args = p.parse_args()
        browser_arm(args) if args.browser_arm else browser_all(args)
    else:
        unittest.main()
