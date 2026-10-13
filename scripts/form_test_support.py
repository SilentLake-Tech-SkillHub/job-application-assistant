"""Shared real-browser fixture harness. Never use the fixture oracle against a live employer.

Baseline uses the existing inventory → fill_plan.from_inventory → fill_field workflow.
Enhanced calls the actual deterministic mapper/compiler; only unresolved widget recipes are
supplied by this synthetic Agent stand-in. Both use identical real UI interactions/readbacks.
"""
import json
import os
import subprocess
import time
from pathlib import Path
import fill_plan
import playwright_fill
from compile_form_mapping import compile_plan
from fixtures.form_sites import PROFILE
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent


def chrome_path():
    if os.environ.get('CHROME_EXECUTABLE'):
        return os.environ['CHROME_EXECUTABLE']
    for root in (os.environ.get('PROGRAMFILES'), os.environ.get('PROGRAMFILES(X86)'), os.environ.get('LOCALAPPDATA')):
        if root:
            for rel in ('Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'):
                p = Path(root) / rel
                if p.is_file():
                    return str(p)
    return None


def scan(page):
    # Injection is restricted to owned mock pages; production IAB must use its read-only evaluate interface.
    page.add_script_tag(content=(HERE / 'inspect_form_controls.js').read_text(encoding='utf-8'))
    return page.evaluate('inspectApplicationForm(document)')


def map_form(inventory, url, cache=None, verified_indexes=None):
    r = subprocess.run(['node', str(HERE / 'map_form_stdin.cjs')],
                       input=json.dumps({'inventory': inventory, 'url': url, 'cache': cache, 'verifiedIndexes': verified_indexes}),
                       capture_output=True, text=True, encoding='utf-8')
    if r.returncode:
        raise ValueError(r.stderr)
    return json.loads(r.stdout)


def mock_recipe(field, semantic, site):
    """Hand-reviewed recipes for owned fixtures only, using existing fill-plan click primitives."""
    if site == 'search-dropdown' and semantic == 'bachelor.school':
        field.update({'控件': '下拉', '填法': '点击',
                      '点击步骤': [{'点击': {'css': '#school-widget'}}, {'选项': PROFILE[semantic]}],
                      '读回定位': {'css': '#school-search'}})
    elif site == 'date-cascade' and semantic == 'bachelor.school':
        field.update({'控件': '级联', '填法': '点击',
                      '点击步骤': [{'点击': {'css': '#cascade'}}, {'点击': {'css': '#level-one'}}, {'点击': {'css': '#level-two'}}],
                      '读回定位': {'css': '#school-readback'}})
    elif site == 'date-cascade' and semantic == 'graduation':
        field.update({'控件': '日期', '填法': '点击',
                      '点击步骤': [{'点击': {'css': '#graduation'}}, {'点击': {'css': '#date-cell'}}],
                      '读回定位': {'css': '#graduation'}})


def plan_for(inventory, site, url, mode, resume, cache=None):
    if mode == 'enhanced':
        mapped = map_form(inventory, url, cache)
        plan = compile_plan(inventory, mapped['mapping'], 'mock-batch', '合成公司', url, 'Playwright')
    else:
        plan = fill_plan.from_inventory(inventory, 'mock-batch', '合成公司', url, 'Playwright')
        # Fixed fixture-only Agent decisions; no new mapper is called in the timed baseline.
        aliases = {'姓名': 'name', 'Full name': 'name', 'Mobile phone': 'phone', 'Email address': 'email',
                   '本科毕业院校': 'bachelor.school', '学历': 'degree', 'Degree': 'degree', '毕业时间': 'graduation',
                   '项目经历': 'project', '简历附件': 'resume'}
        sources = {'name': '姓名', 'phone': '手机号', 'email': '邮箱', 'bachelor.school': '学校-本科',
                   'master.school': '学校-硕士', 'degree': '学历', 'graduation': '毕业时间', 'project': '项目经历'}
        oracle = []
        for f in plan['字段']:
            raw = next(c for c in inventory['fields'] if c['label'] == f['标签'] and
                       (f['定位'].get('label') == c['label'] or f['定位'].get('css') == (c.get('controlLocator') or c['locator'])))
            label = f['标签'].replace(' *', '').strip()
            key = aliases.get(label)
            if label == '就读院校':
                key = 'master.school' if '硕士' in raw.get('group', '') else 'bachelor.school'
            oracle.append({'index': raw['index'], 'label': f['标签'], 'locator': f['定位'], 'semantic': key,
                           'source': '材料:简历' if key == 'resume' else '档案:' + sources[key], 'disposition': 'automatic'})
        mapped = {'mapping': {'fields': oracle, 'cacheHit': False}}
    fields = mapped['mapping']['fields']
    assignments = []
    for f in plan['字段']:
        # The oracle provides Agent decisions for baseline, and exception-only recipes for enhanced.
        candidates = [x for x in fields if x['locator'] == f['定位']]
        if len(candidates) != 1:
            raise AssertionError('Fixture field identity is ambiguous: ' + f['标签'])
        match = candidates[0]
        key = match['semantic']
        if not key:
            raise AssertionError('Unknown fixture semantic: ' + str(match))
        if mode == 'baseline' or match['disposition'] == 'exception':
            mock_recipe(f, key, site)
            assignments.append({'field': f['序号'], 'source': match['source'], 'locator': f['定位'], 'recipe': f.get('点击步骤')})
        f['状态'] = '待填'
        value = str(resume) if key == 'resume' else PROFILE[key]
        # Fixture values are passed in memory; privacy fields keep sources even in test plans.
        f['值来源'] = match['source']
        if key == 'resume':
            f.update({'控件': '上传', '填法': '上传', '读回定位': {'css': '#filename'}, '读回方式': '文本'})
        elif f['填法'] == '用户':
            raise AssertionError('Exception has no fixture recipe')
        f['_test_value'] = value
    # Test-only values are removed before validation: production plan schema remains unchanged.
    clean = {**plan, '字段': [{k: v for k, v in f.items() if k != '_test_value'} for f in plan['字段']]}
    assert not fill_plan.validate(clean), fill_plan.validate(clean)
    return plan, mapped, assignments


def execute_case(page, site, url, mode, resume, cache=None):
    selected = urlsplit(url)
    if selected.scheme != 'http' or selected.hostname != '127.0.0.1' or not selected.port or selected.path != '/forms/' + site:
        raise ValueError('Fixture submission harness is restricted to its exact owned loopback route')
    if mode not in ('baseline', 'enhanced'):
        raise ValueError('Unknown test mode')
    page.goto(url)
    page.wait_for_selector('#application')
    start = time.perf_counter()
    inventory = scan(page)
    plan, mapped, assignments = plan_for(inventory, site, url, mode, resume, cache)
    messages = []
    if mode == 'baseline':
        messages.append({'role': 'tool', 'kind': 'inventory', 'content': inventory})
        messages.append({'role': 'assistant', 'kind': 'field-decisions', 'content': assignments})
    else:
        messages.append({'role': 'tool', 'kind': 'mapping-summary', 'content': mapped['summary']})
        if assignments:
            messages.append({'role': 'assistant', 'kind': 'exception-decisions', 'content': assignments})
    verified, readbacks = [], []
    for f in plan['字段']:
        if f['控件'] == '上传':
            ok, _ = playwright_fill.fill_field(page, f, f['_test_value'], 2500)
            assert ok
            page.wait_for_function("document.getElementById('status').textContent === '解析完成'")
            # Upload invalidates concrete element identities; both modes re-inventory the changed form.
            inventory = scan(page)
            plan_after, mapped, decisions = plan_for(inventory, site, url, mode, resume)
            replacements = {x['标签']: x for x in plan_after['字段'] if x['控件'] != '上传'}
            for old in plan['字段']:
                if old['控件'] != '上传':
                    old.update(replacements[old['标签']])
            messages.append({'role': 'tool', 'kind': 'post-upload-inventory' if mode == 'baseline' else 'post-upload-summary',
                             'content': inventory if mode == 'baseline' else mapped['summary']})
            if decisions:
                messages.append({'role': 'assistant', 'kind': 'post-upload-decisions', 'content': decisions})
        else:
            ok, _ = playwright_fill.fill_field(page, f, f['_test_value'], 2500)
            assert ok, (site, f['标签'])
        match = next(x for x in mapped['mapping']['fields'] if x['label'] == f['标签'] and x['locator'] == f['定位'])
        verified.append(match['index'])
        readbacks.append({'label': f['标签'], 'matched': True})
    # Identical server-side persistence check in both modes; no DOM text-only success claim.
    with page.expect_response(lambda r: '/api/draft/' in r.url) as response:
        page.locator('#save').click()
    assert response.value.status == 200, response.value.text()
    persisted = page.request.get(url.split('/forms/')[0] + '/api/draft/' + site).json()
    for key, value in persisted.items():
        assert value == ('synthetic-resume.pdf' if key == 'resume' else PROFILE[key])
    fill_seconds = time.perf_counter() - start
    # Mock-only final click. Production helpers cannot submit; this harness never targets a live URL.
    with page.expect_response(lambda r: '/api/submit/' in r.url) as response:
        page.locator('#submit').click()
    assert response.value.status == 200
    receipt = response.value.json()['receipt']
    server_receipt = page.request.get(url.split('/forms/')[0] + '/api/receipt/' + receipt).json()
    assert server_receipt['site'] == site and server_receipt['values'] == persisted
    total_seconds = time.perf_counter() - start
    messages.append({'role': 'tool', 'kind': 'readback-and-receipt', 'content': {'readbacks': readbacks, 'saved': True, 'receipt_verified': True}})
    committed = map_form(inventory, url, verified_indexes=verified)['cache'] if mode == 'enhanced' else None
    return {'site': site, 'mode': mode, 'cache_hit': mapped['mapping']['cacheHit'],
            'fill_seconds': fill_seconds, 'total_seconds': total_seconds, 'correct_fields': len(persisted),
            'receipt_verified': True, 'messages': messages, 'cache': committed}
