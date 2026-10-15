"""No paid model: preparation invariants plus actual optimized five-form mock validation."""
import sys
import tempfile
import unittest
from pathlib import Path
from form_preparation import prepare_automatic, DocumentBundle, diagnostic_allowed


class PreparationTests(unittest.TestCase):
    def test_upload_rescan_and_current_readback_skip(self):
        generation, calls = [0], []
        def capture():
            return {'fields': [
                {'index': 0, 'semantic': 'resume', 'source': '材料:简历', 'disposition': 'automatic'},
                {'index': 1 + generation[0], 'semantic': 'name', 'source': '档案:姓名', 'disposition': 'automatic'},
                {'index': 9, 'semantic': None, 'source': None, 'disposition': 'exception'}]}
        def apply(work):
            calls.append([f['index'] for f in work])
            if not generation[0]:
                generation[0] = 1
                return {'readbacks': [0], 'requires_rescan': True}
            return {'readbacks': [2], 'requires_rescan': False}
        result = prepare_automatic(capture, lambda f: generation[0] == 1 and f['semantic'] == 'resume', apply)
        self.assertEqual(calls, [[0, 1], [2]])
        self.assertEqual(result['passes'], 2); self.assertEqual(result['skipped_current_readbacks'], [0])

    def test_invalidation_is_bounded_and_unknown_sources_never_execute(self):
        with self.assertRaisesRegex(ValueError, 'No rendered fields'):
            prepare_automatic(lambda: {'fields': []}, lambda f: False,
                              lambda f: self.fail('Empty inventory executed'))
        with self.assertRaises(ValueError):
            prepare_automatic(lambda: {'fields': []}, lambda f: False,
                              lambda f: {'readbacks': [], 'requires_rescan': True}, max_passes=0)
        with self.assertRaises(ValueError):
            prepare_automatic(lambda: {'fields': [{'disposition': 'automatic', 'source': None}]},
                              lambda f: False, lambda f: self.fail('Unknown source executed'))
        field = {'index': 0, 'semantic': 'name', 'source': '档案:姓名', 'disposition': 'automatic'}
        with self.assertRaisesRegex(ValueError, 'kept invalidating'):
            prepare_automatic(lambda: {'fields': [field]}, lambda f: False,
                              lambda f: {'readbacks': [], 'requires_rescan': True}, max_passes=2)

    def test_document_once_but_changed_document_is_returned(self):
        source = {'text': 'version1'}
        bundle = DocumentBundle(lambda p: dict(source))
        first = bundle.get('instructions'); second = bundle.get('instructions')
        self.assertEqual(first['sha256'], second['sha256']); self.assertTrue(second['already_loaded'])
        self.assertNotIn('document', second)
        source['text'] = 'version2'
        self.assertEqual(bundle.get('instructions')['document']['text'], 'version2')

    def test_diagnostics_require_an_unresolved_problem(self):
        self.assertFalse(diagnostic_allowed([], 1, 'old failure'))
        self.assertFalse(diagnostic_allowed([1], 0, None))
        self.assertTrue(diagnostic_allowed([1], 1, None))
        self.assertTrue(diagnostic_allowed([1], 0, 'observed failure'))

    def test_diagnostic_source_is_bounded_and_omissions_are_explicit(self):
        from rea_bridge import script_excerpts
        artifact = {'sha256': 'synthetic', 'text': 'unrelated\n' * 100 + 'school_widget.onclick=' + 'x' * 5000}
        excerpts = script_excerpts([artifact], ['#school_widget'], budget=128)
        self.assertTrue(excerpts[0]['omitted'])
        self.assertLessEqual(sum(len(s['text']) for s in excerpts[0]['snippets']), 128)
        self.assertTrue(any(s['partial_line'] for s in excerpts[0]['snippets']))


def browser_checks():
    from optimized_form_controller import OptimizedController
    from fixtures.form_sites import SITES
    case = unittest.TestCase()
    with tempfile.TemporaryDirectory() as d:
        c = OptimizedController('optimized', Path(d), Path(__file__).resolve().parent.parent, Path('not-needed-offline'))
        try:
            with case.assertRaises(ValueError): c.prepare_forms(['native-bilingual'])
            c.bootstrap()
            case.assertTrue(c.document('SKILL.md')['already_loaded'])
            state = c.prepare_forms(SITES)['forms']
            case.assertEqual([s['site'] for s in state if s['ready_for_review']],
                             ['native-bilingual', 'repeated-education', 'upload-rerender'])
            case.assertEqual(next(s for s in state if s['site'] == 'upload-rerender')['passes'], 2)
            with case.assertRaises(ValueError): c.diagnose_bindings('search-dropdown', 'routine capture forbidden')
            with case.assertRaises(ValueError): c.review_submit_batch(['search-dropdown'])
            with case.assertRaises(ValueError):
                c.complete_fields([{'site': 'repeated-education', 'fields': [{'index': 1, 'source': 'bachelor.school'}]}])
            # Offline fixture recipes only. The paid model derives these from actual rendered menus.
            groups = [
                {'site': 'search-dropdown', 'fields': [{'index': 1, 'source': 'bachelor.school',
                    'clicks': [{'css': '#school-widget'}, {'role': 'option', 'name': '合成本科大学'}], 'readback': {'css': '#school-search'}}]},
                {'site': 'date-cascade', 'fields': [
                    {'index': 1, 'source': 'bachelor.school', 'clicks': [{'css': '#cascade'}, {'css': '#level-one'}, {'css': '#level-two'}], 'readback': {'css': '#school-readback'}},
                    {'index': 2, 'source': 'graduation', 'clicks': [{'css': '#graduation'}, {'css': '#date-cell'}], 'readback': {'css': '#graduation'}}]}]
            result = c.complete_fields(groups)
            case.assertTrue(all(x['ready_for_review'] for x in result['forms']))
            # A matching visible string with a cleared underlying widget model must fail server draft.
            c.pages['search-dropdown'].locator('#school-search').fill('合成本科大学')
            rejected = c.review_submit_batch(['search-dropdown'])
            case.assertFalse(rejected['sites']['search-dropdown']['submitted'])
            case.assertEqual(c.state['receipts'], {})
            case.assertTrue(c.preparation_state('search-dropdown')['rea_eligible'])
            c.prepare_forms(['search-dropdown']); c.complete_fields([groups[0]])
            # Missing approval cannot pass the real Submit gate even with correct UI fields.
            with case.assertRaises(ValueError): c.gate('submit', 'search-dropdown')
            submitted = c.review_submit_batch(SITES)['sites']
            case.assertEqual(len(submitted), 5)
            case.assertTrue(all(r['server_verified'] and r['tracker_verified'] for r in submitted.values()))
            case.assertEqual(c.finish()['rea_calls'], 0)
            case.assertEqual(len(c.state['receipts']), 5)
            # Cached receipts cannot trigger duplicate real submission.
            c.review_submit_batch(SITES); case.assertEqual(len(c.state['receipts']), 5)
            print('PASS optimized controller: five real receipts, stale binding rejection, approval gate, upload rescan, no routine REA', flush=True)
        finally:
            c.close()


if __name__ == '__main__':
    if '--browser' in sys.argv: browser_checks()
    else: unittest.main()
