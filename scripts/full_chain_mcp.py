#!/usr/bin/env python3
"""Owned mock-only MCP controller for a real model-driven application batch.

No fixture recipes or server EXPECTED manifest are exposed to the model. Baseline semantics and
all custom-widget click paths are decided by the model from live DOM and approved synthetic facts.
Enhanced automatic fields use the shipping mapper/compiler; REA is a separate actual CLI tool.
The controller owns the browser/server, enforces stage gates and simulates the mock user's review.
"""
import argparse
import datetime
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
import fill_plan
import playwright_fill
from compile_form_mapping import compile_plan
from fixtures.form_sites import PROFILE, SITES, serve
from fixtures.workspace import Workspace, now
from form_test_support import chrome_path, scan, map_form
from rea_bridge import inspect as rea_inspect
from stage_gate import run as stage_gate

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROFILE_KEYS = {'name': '姓名', 'phone': '手机号', 'email': '邮箱', 'bachelor.school': '学校-本科',
                'master.school': '学校-硕士', 'degree': '学历', 'graduation': '毕业时间', 'project': '项目经历'}


class Controller:
    def __init__(self, mode, root, docs, rea_entry):
        self.mode, self.root, self.docs = mode, Path(root).resolve(), Path(docs).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.log_path = self.root / 'tool-events.jsonl'
        self.rea_entry = Path(rea_entry)
        self.server, self.state, self.base = serve()
        self.companies = {s: '合成测试公司%d' % (i + 1) for i, s in enumerate(SITES)}
        (self.root / 'workspace').mkdir()
        self.w = Workspace(self.root / 'workspace', batch='fullchain', companies=tuple((c, '全部') for c in self.companies.values()),
                           targets='全部=无', rule='留空', basis='有合格岗位的公司')
        self.resume = self.w.root / 'synthetic-resume.pdf'
        shutil.copy(self.w.root / '简历.pdf', self.resume)
        self.w.write_query('全部=无', '留空', '有合格岗位的公司',
                           材料='- 简历 | synthetic-resume.pdf | ' + hashlib.sha256(self.resume.read_bytes()).hexdigest(),
                           自动化授权='模式: 半自动\n已开启: privacy-info-fill\n条款方式: 逐项查看\n验证码: 用户提供',
                           能力预检='内置浏览器: 不可用\nChrome: 不可用\ncomputer use: 不适用\n系统脚本: 可用\nPlaywright: 可用')
        self.profile = {PROFILE_KEYS[k]: v for k, v in PROFILE.items()}
        vault = self.w.root / '个人信息档案.md'
        vault.write_text('# 合成测试档案\n\n' + '\n'.join('| %s | %s | synthetic approved fact |' % (k, v) for k, v in self.profile.items()), encoding='utf-8')
        for site, company in self.companies.items():
            url = self.base + '/forms/' + site
            self.w.tag(company, '已有相关岗位记录'); self.w.add_role(company, url)
            self.w.company_ready(company, limit=1, lane='Playwright'); self.w.role_ready(company, url)
        self.gate('query')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
        self.cdp = 'http://127.0.0.1:%d' % port
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=True, executable_path=chrome_path(), args=['--remote-debugging-port=%d' % port])
        self.pages, self.inventories, self.plans, self.mappings, self.receipts = {}, {}, {}, {}, {}
        self.rea_calls = 0

    def close(self):
        self.browser.close(); self.pw.stop(); self.server.shutdown(); self.server.server_close()

    def event(self, **data):
        with self.log_path.open('a', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps({'wall_time_ns': time.time_ns(), 'monotonic_ns': time.perf_counter_ns(), **data}, ensure_ascii=False) + '\n')

    def gate(self, stage, site=None):
        result = stage_gate(self.w.book, self.w.batch, stage, self.base + '/forms/' + site if site else None)
        if not result['允许']:
            raise ValueError('Stage gate %s blocked: %s' % (stage, result.get('错误')))
        return result

    def check_site(self, site):
        if site not in SITES:
            raise ValueError('Select one owned mock site ID')
        if site in self.receipts:
            raise ValueError('This mock application already has a verified receipt; no duplicate actions')

    def page(self, site):
        self.check_site(site)
        if site not in self.pages:
            self.gate('prepare', site)
            p = self.browser.new_page()
            p.goto(self.base + '/forms/' + site); p.wait_for_selector('#application')
            self.pages[site] = p
        return self.pages[site]

    def document(self, path):
        if path == 'synthetic-profile':
            return {'facts': PROFILE, 'sources': PROFILE_KEYS, 'resume': 'approved synthetic-resume.pdf',
                    'authority': 'Synthetic test user facts only; no actual personal data'}
        if path == 'batch-contract':
            return {'batch': 'fullchain', 'companies': self.companies, 'roles': SITES,
                    'query': (self.w.bdir / '批次/Query.md').read_text(encoding='utf-8'),
                    'prerequisites': 'Confirmed synthetic role list, JD/eligibility, per-company order/quota and form preparation are preseeded. Query and Prepare gates are real.',
                    'review': 'review_submit checks exact saved form and simulates this mock user approval, then runs real Review/Submit gates, actual UI submission, server receipt and Excel readback.',
                    'lane': 'CLI has no in-app/Chrome extension binding; existing Playwright backup lane. No live employer or human wait.'}
        p = (self.docs / path).resolve()
        if not p.is_relative_to(self.docs.resolve()) or p.suffix != '.md' or not p.is_file():
            raise ValueError('Only the staged Skill Markdown and synthetic profile/batch are readable')
        return {'path': path, 'text': p.read_text(encoding='utf-8')}

    def observe(self, site):
        p = self.page(site)
        inventory = scan(p); self.inventories[site] = inventory
        if site not in self.plans:
            self.plans[site] = fill_plan.from_inventory(inventory, self.w.batch, self.companies[site], p.url, 'Playwright')
        # Only rendered DOM; test implementation/oracle/internal JS model is never returned here.
        ui = p.evaluate('''() => [...document.querySelectorAll('button,[role="option"],[role="combobox"]')]
          .filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none')
          .map(e=>({role:e.getAttribute('role')||'button',text:(e.textContent||'').trim().slice(0,120),
          css:e.id?'#'+CSS.escape(e.id):null}))''')
        if self.mode == 'baseline':
            return {'inventory': inventory, 'visible_ui': ui, 'status': p.locator('#status').inner_text(),
                    'instructions': 'Decide every field source from profile and group; configure_fill batches native fields. Real click paths must be supplied for custom widgets. Upload first, then observe again.'}
        mapped = map_form(inventory, p.url); self.mappings[site] = mapped['mapping']
        return {'mapping_summary': mapped['summary'],
                'exceptions': [dict(f, control=next(c for c in inventory['fields'] if c['index'] == f['index'])) for f in mapped['mapping']['fields'] if f['disposition'] == 'exception'],
                'visible_ui': ui, 'status': p.locator('#status').inner_text(),
                'instructions': 'auto_fill handles clear native fields and upload; custom exceptions need model-reviewed real clicks. Use rea_inspect on complex controls, interpret source evidence, then configure_fill. Rescan after upload.'}

    def item_field(self, inventory, index):
        matches = [c for c in inventory['fields'] if c['index'] == index and c['kind'] != 'button']
        if len(matches) != 1:
            raise ValueError('Unknown current inventory field index')
        c = matches[0]
        skeleton = fill_plan.from_inventory({'fields': [c]}, self.w.batch, self.companies[self.active_site], self.pages[self.active_site].url, 'Playwright')
        if len(skeleton['字段']) != 1:
            raise ValueError('Unrecognized field')
        f = skeleton['字段'][0]
        # Repeated label identity comes from refreshed CSS, not a broad label lookup.
        if sum(g.get('label') == c.get('label') for g in inventory['fields']) > 1:
            f['定位'] = {'css': c.get('controlLocator') or c['locator']}
        return c, f

    def configure_fill(self, site, fields):
        p = self.page(site); self.active_site = site
        inventory = self.inventories.get(site)
        if inventory is None:
            raise ValueError('Observe current page first')
        results = []
        for spec in fields:
            c, field = self.item_field(inventory, spec['index'])
            key = spec['source']
            if key not in PROFILE and key != 'resume':
                raise ValueError('Use an approved profile source, never invent data')
            value = str(self.resume) if key == 'resume' else PROFILE[key]
            field['值来源'] = '材料:简历' if key == 'resume' else '档案:' + PROFILE_KEYS[key]
            if spec.get('clicks'):
                if field['控件'] not in ('下拉', '级联', '日期', '其他'):
                    raise ValueError('Custom clicks require a matching complex control')
                field.update({'填法': '点击', '点击步骤': [{'点击': loc} for loc in spec['clicks']],
                              '读回定位': spec.get('readback') or {'css': c.get('controlLocator') or c['locator']}})
            if key == 'resume':
                field.update({'控件': '上传', '填法': '上传', '读回定位': {'css': '#filename'}, '读回方式': '文本'})
            if field['填法'] == '用户' or (field['填法'] == '点击' and not spec.get('clicks')):
                raise ValueError('Supply the actual complex-widget click path and readback locator')
            errors = fill_plan.field_errors(field, 1, ready=True)
            if errors:
                raise ValueError('; '.join(errors))
            ok, got = playwright_fill.fill_field(p, field, value, 3000)
            if not ok:
                raise ValueError('Field readback mismatch: ' + field['标签'])
            field.update({'状态': '已读回', '读回': '一致' if fill_plan.sensitive(field) else got, '更新时间': now()})
            plan = self.plans[site]
            prior = [f for f in plan['字段'] if f['标签'] == field['标签'] and f['定位'] == field['定位']]
            if prior:
                pos = plan['字段'].index(prior[0]); field['序号'] = prior[0]['序号']; plan['字段'][pos] = field
            else:
                # Replace the matching current source identity; avoid duplicate placeholder fields.
                candidates = [f for f in plan['字段'] if f['标签'] == field['标签'] and f['状态'] != '已读回']
                if len(candidates) == 1:
                    pos = plan['字段'].index(candidates[0]); field['序号'] = candidates[0]['序号']; plan['字段'][pos] = field
                else:
                    field['序号'] = len(plan['字段']) + 1; plan['字段'].append(field)
            results.append({'index': spec['index'], 'label': field['标签'], 'readback': 'matched'})
            if key == 'resume':
                p.wait_for_function("document.getElementById('status').textContent === '解析完成'")
                # Rebuild current identities, preserving the genuinely read-back upload only.
                newer = scan(p); self.inventories[site] = newer
                fresh = fill_plan.from_inventory(newer, self.w.batch, self.companies[site], p.url, 'Playwright')
                for f in fresh['字段']:
                    if f['控件'] == '上传':
                        f.update({k: v for k, v in field.items() if k != '序号'})
                self.plans[site] = fresh
                return {'readbacks': results, 'requires_rescan': True, 'reason': 'Upload parsing replaced DOM nodes; inspect before subsequent fields'}
        self.save_plan(site)
        return {'readbacks': results, 'requires_rescan': False}

    def auto_fill(self, site):
        if self.mode != 'enhanced':
            raise ValueError('Automatic semantic mapping is unavailable in baseline')
        p = self.page(site)
        inventory = scan(p); mapped = map_form(inventory, p.url)['mapping']; self.inventories[site] = inventory; self.mappings[site] = mapped
        plan = compile_plan(inventory, mapped, self.w.batch, self.companies[site], p.url, 'Playwright')
        sources = {v: k for k, v in PROFILE_KEYS.items()}
        upload_done = any(f['控件'] == '上传' and f['状态'] == '已读回' for f in self.plans[site]['字段'])
        work = [f for f in mapped['fields'] if f['disposition'] == 'automatic'
                and not (f['semantic'] == 'resume' and upload_done)]
        work.sort(key=lambda f: 0 if f['semantic'] == 'resume' else 1)
        fields = [{'index': f['index'], 'source': 'resume' if f['semantic'] == 'resume' else sources[f['source'][3:]]} for f in work]
        # Save validated compiled plan only on first preparation; successful prior widget fields survive.
        if not any(f['状态'] == '已读回' for f in self.plans[site]['字段']):
            self.plans[site] = plan
        return self.configure_fill(site, fields)

    def inspect_ui(self, site, clicks):
        p = self.page(site)
        playwright_fill.run_steps(p, [{'点击': loc} for loc in clicks], 3000)
        return self.observe(site)

    def save_plan(self, site):
        folder = self.w.role_folder(self.companies[site], self.base + '/forms/' + site)
        fill_plan.save(folder / fill_plan.PLAN_NAME, self.plans[site])

    def rea(self, site):
        if self.mode != 'enhanced':
            raise ValueError('REA diagnostics are unavailable in baseline')
        p = self.page(site)
        with urllib.request.urlopen(self.cdp + '/json/list', timeout=5) as r:
            matches = [t for t in json.load(r) if t.get('url') == p.url and t.get('type') == 'page']
        if len(matches) != 1:
            raise ValueError('Exact owned CDP target was not unique')
        out = self.root / ('rea-' + site + '.json')
        result = rea_inspect(['node', str(self.rea_entry)], self.cdp, matches[0]['id'], self.base, out, include_script_sources=True)
        evidence = json.loads(out.read_bytes())
        snippets = []
        for script in evidence['normalized_result']['scripts']['items']:
            source = script.get('source', {})
            if source.get('included'):
                snippets.append(source['artifact'])
        self.rea_calls += 1
        return {'summary': result, 'captured_script_sources': snippets,
                'instruction': 'Interpret observed frontend binding behavior; do not invoke internal APIs or write JS model/value. Use actual clicks.'}

    def review_submit(self, site):
        p = self.page(site); company = self.companies[site]; url = self.base + '/forms/' + site
        folder = self.w.role_folder(company, url)
        # Server validation independently catches wrong semantics and fake component selections.
        with p.expect_response(lambda r: r.url == self.base + '/api/draft/' + site) as resp:
            p.locator('#save').click()
        if resp.value.status != 200:
            return {'saved': False, 'validation_error': resp.value.json(), 'submitted': False}
        persisted = p.request.get(self.base + '/api/draft/' + site).json()
        plan = self.plans[site]
        # All plan fields must reflect actual current UI; previously checked stale fields cannot pass.
        for f in plan['字段']:
            if f['状态'] != '已读回':
                raise ValueError('Pending plan field: ' + f['标签'])
            value = str(self.resume) if f['控件'] == '上传' else self.profile.get((f.get('值来源') or '').split(':', 1)[-1])
            ok, got = playwright_fill.poll(p, f, value, 2000)
            if not ok:
                raise ValueError('Current-page readback failed: ' + f['标签'])
            f['更新时间'] = now()
        shot = folder / '填写截图.png'; p.screenshot(path=str(shot), full_page=True)
        plan['页面校验'] = {'结果': '通过', '时间': now(), '观察': shot.relative_to(self.w.root).as_posix()}
        self.save_plan(site); fill_plan.export_readback(folder / fill_plan.PLAN_NAME)
        (folder / '草稿读回.md').write_text('重开后一致: 是\n来源: 服务端草稿 GET 读回并逐字段对照当前 UI\n', encoding='utf-8')
        (folder / '审核包.md').write_text('# 当前 mock 审核包\n\n' + json.dumps(persisted, ensure_ascii=False, indent=2), encoding='utf-8')
        self.gate('review', site)
        self.w.role_approved(company, url)  # Explicit simulated mock-user response; real human delay not fabricated.
        self.gate('submit', site)
        with p.expect_response(lambda r: r.url == self.base + '/api/submit/' + site) as resp:
            p.locator('#submit').click()
        if resp.value.status != 200:
            raise ValueError('Mock final submission failed')
        receipt = resp.value.json()['receipt']
        got = p.request.get(self.base + '/api/receipt/' + receipt).json()
        if got.get('site') != site or got.get('values') != persisted:
            raise ValueError('Independent server receipt mismatch')
        (folder / '回执.md').write_text('申请编号: ' + receipt + '\n', encoding='utf-8')
        backup = self.w.root / ('backup-' + site + '.xlsx'); shutil.copy(self.w.book, backup)
        pre = hashlib.sha256(backup.read_bytes()).hexdigest()
        self.w.set_apply_status(url, '已提交')
        r = subprocess.run([sys.executable, str(HERE / 'tracker_readback.py'), '--workbook', str(self.w.book), '--backup', str(backup),
                            '--pre-sha256', pre, '--expect', '中国大陆|岗位链接|' + url + '|投递状态=已提交', '--record', str(folder / '追踪表读回.md')],
                           capture_output=True, text=True, encoding='utf-8', env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        if r.returncode:
            raise ValueError('Excel readback failed: ' + r.stdout[-1000:])
        self.receipts[site] = {'receipt': receipt, 'server_verified': True, 'tracker_verified': True}
        self.event(kind='verified_receipt', site=site, receipt=receipt)
        return self.receipts[site]

    def finish(self):
        if set(self.receipts) != set(SITES):
            raise ValueError('All five applications must have independently verified receipts')
        if self.mode == 'enhanced' and self.rea_calls < 1:
            raise ValueError('Enhanced test requires at least one actual REA capture and interpretation')
        self.w.closeout_file(retained='All five owned mock pages retained until runner shutdown')
        final = self.gate('closeout')
        result = {'sites': self.receipts, 'rea_calls': self.rea_calls, 'closeout_gate': final['允许'], 'verified_at_ns': time.time_ns()}
        (self.root / 'verified-batch.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        self.event(kind='batch_verified')
        return result


def schema(properties, required):
    return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}


def tools_for(mode):
    site = {'type': 'string', 'enum': SITES}
    tools = [
        ('read_document', 'Read staged Skill Markdown by relative path, synthetic-profile, or batch-contract. Start with SKILL.md and batch-contract.', schema({'path': {'type': 'string'}}, ['path'])),
        ('observe', 'Inspect live rendered DOM and actual visible options/buttons. Baseline returns full inventory; enhanced returns semantic summary and exceptions.', schema({'site': site}, ['site'])),
        ('inspect_ui', 'Open a visible custom widget or advance its visible menu, using actual guarded clicks, then return a fresh observation. Never use save/submit buttons here.', schema({'site': site, 'clicks': {'type': 'array', 'items': {'type': 'object'}}}, ['site', 'clicks'])),
        ('configure_fill', 'Model selects profile sources for fields. Use current inventory index. For custom widgets supply real click locator sequence and scalar readback locator. Upload first and observe again.',
         schema({'site': site, 'fields': {'type': 'array', 'items': schema({'index': {'type': 'integer'}, 'source': {'type': 'string', 'enum': list(PROFILE) + ['resume']},
                                                                            'clicks': {'type': 'array', 'items': {'type': 'object'}}, 'readback': {'type': 'object'}}, ['index', 'source'])}}, ['site', 'fields'])),
        ('review_submit', 'Save and read server draft; recheck every field; build real review evidence; simulate approved mock-user decision; run real Review/Submit gates; actual UI submit, server receipt, Excel readback.', schema({'site': site}, ['site'])),
        ('finish_batch', 'Verify five server receipts and workbook; run actual closeout gate. Only after every site completes.', schema({}, [])),
    ]
    if mode == 'enhanced':
        tools += [('auto_fill', 'Shipping semantic mapper/compiler fills only unambiguous native fields through existing real input APIs. Exceptions remain for model diagnosis; upload returns requires_rescan.', schema({'site': site}, ['site'])),
                  ('rea_inspect', 'Actually run REA CLI passive capture on the exact owned current CDP target, including script-source Evidence. Interpret frontend bindings to plan actual UI clicks.', schema({'site': site}, ['site']))]
    return [{'name': name, 'description': desc, 'inputSchema': spec} for name, desc, spec in tools]


def run_server(args):
    controller = None
    for line in sys.stdin:
        request = json.loads(line); ident = request.get('id'); method = request.get('method')
        if ident is None:
            continue
        try:
            if method == 'initialize':
                result = {'protocolVersion': request.get('params', {}).get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'owned-form-benchmark', 'version': '1'}}
            elif method == 'tools/list':
                result = {'tools': tools_for(args.mode)}
            elif method == 'ping':
                result = {}
            elif method == 'tools/call':
                if controller is None:
                    boot = time.perf_counter_ns(); boot_wall = time.time_ns()
                    controller = Controller(args.mode, args.root, args.docs, args.rea_entry)
                    controller.event(kind='tool_completed', name='controller_startup',
                                     seconds=(time.perf_counter_ns() - boot) / 1e9, start_wall_ns=boot_wall, error=False)
                name = request['params']['name']; data = request['params'].get('arguments', {})
                start = time.perf_counter_ns(); wall_start = time.time_ns()
                controller.event(kind='tool_started', name=name, arguments=data, start_ns=start)
                try:
                    if name not in {t['name'] for t in tools_for(args.mode)}:
                        raise ValueError('Unknown/unavailable tool')
                    function = {'read_document': controller.document, 'observe': controller.observe, 'inspect_ui': controller.inspect_ui, 'configure_fill': controller.configure_fill,
                                'auto_fill': controller.auto_fill, 'rea_inspect': controller.rea, 'review_submit': controller.review_submit,
                                'finish_batch': controller.finish}[name]
                    output = function(**data)
                    controller.event(kind='tool_completed', name=name, seconds=(time.perf_counter_ns() - start) / 1e9,
                                     start_wall_ns=wall_start, result=output, error=False)
                    result = {'content': [{'type': 'text', 'text': json.dumps(output, ensure_ascii=False)}]}
                except Exception as e:
                    controller.event(kind='tool_completed', name=name, seconds=(time.perf_counter_ns() - start) / 1e9,
                                     start_wall_ns=wall_start, error=True, error_type=type(e).__name__, message=str(e))
                    result = {'isError': True, 'content': [{'type': 'text', 'text': str(e)}]}
            else:
                raise ValueError('Unsupported RPC method')
            response = {'jsonrpc': '2.0', 'id': ident, 'result': result}
        except Exception as e:
            response = {'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32603, 'message': str(e)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    if controller:
        controller.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['baseline', 'enhanced'], required=True)
    parser.add_argument('--root', type=Path, required=True); parser.add_argument('--docs', type=Path, required=True)
    parser.add_argument('--rea-entry', type=Path, required=True)
    run_server(parser.parse_args())
