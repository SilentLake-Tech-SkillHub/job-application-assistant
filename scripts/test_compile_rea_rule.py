"""Real owned DOM -> verified rule -> existing pending plans for all three lanes."""
from pathlib import Path
import tempfile
from optimized_form_controller import OptimizedController
from fixtures.form_sites import PROFILE, SITES
from form_test_support import scan, map_form
from rea_rule_store import RuleStore, form_scope
from compile_rea_rule import compile_rule
import fill_plan


def main():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory() as directory:
        c = OptimizedController('optimized', Path(directory) / 'controller', root, Path('offline-compiler-test'))
        try:
            c.bootstrap(); c.prepare_forms(SITES)
            groups = [
                {'site': 'search-dropdown', 'fields': [{'index': 1, 'source': 'bachelor.school',
                    'clicks': [{'css': '#school-widget'}, {'role': 'option', 'name': PROFILE['bachelor.school']}], 'readback': {'css': '#school-search'}}]},
                {'site': 'date-cascade', 'fields': [
                    {'index': 1, 'source': 'bachelor.school', 'clicks': [{'css': '#cascade'}, {'css': '#level-one'}, {'css': '#level-two'}], 'readback': {'css': '#school-readback'}},
                    {'index': 2, 'source': 'graduation', 'clicks': [{'css': '#graduation'}, {'css': '#date-cell'}], 'readback': {'css': '#graduation'}}]}]
            c.complete_fields(groups); c.review_submit_batch(SITES)
            store = RuleStore(Path(directory) / 'rules')
            for site in SITES:
                page = c.pages[site]; inventory = scan(page); mapping = map_form(inventory, page.url)['mapping']
                recipes = []
                for field in mapping['fields']:
                    steps = []
                    if field['disposition'] != 'automatic':
                        steps = [{'target': 'wrapper'}]
                        if field['semantic'] == 'bachelor.school' and site == 'date-cascade':
                            steps.append({'role': 'option', 'name': '合成省'})
                        steps.append({'role': 'button' if field['semantic'] == 'graduation' else 'option',
                                      'name': {'value_source': field['semantic']}})
                    recipes.append({'source': field['semantic'], 'steps': steps, 'readback': 'current-control'})
                candidate = store.candidate(form_scope(page.url), inventory, mapping, recipes,
                                            {'sha256': 'f' * 64, 'truncated': False, 'operation': 'offline-compiler-fixture'})
                def verify():
                    state = c.preparation_state(site)
                    actual = page.request.get(c.base + '/api/draft/' + site).json()
                    expected = {r['source']: (c.resume.name if r['source'] == 'resume' else PROFILE[r['source']]) for r in recipes}
                    return {'current_readbacks': state['verified_fields'], 'server_draft_matched': actual == expected}
                rule = store.promote(candidate, verify)
                for lane in fill_plan.LANES:
                    plan = compile_rule(rule, inventory, mapping, PROFILE, c.w.batch, c.companies[site], page.url, lane)
                    assert plan['通道'] == lane and all(f['状态'] == '待填' and not f['读回'] for f in plan['字段'])
                    assert not fill_plan.validate(plan, ready=True)
                    assert len(plan['字段']) == len(mapping['fields'])
                if site == 'search-dropdown':
                    changed = dict(PROFILE, **{'bachelor.school': '本次新学校'})
                    plan = compile_rule(rule, inventory, mapping, changed, c.w.batch, c.companies[site], page.url, '内置浏览器')
                    school = next(f for f in plan['字段'] if f['值来源'] == '档案:学校-本科')
                    assert school['点击步骤'][-1]['点击']['name'] == '本次新学校'
                    assert school['读回定位']['css'] == '#school-search'
                print('PASS current pending-plan compiler: ' + site + ' x IAB/Chrome/Playwright')
            assert len(c.state['receipts']) == 5  # compiling does not submit anything
        finally:
            c.close()


if __name__ == '__main__':
    main()
