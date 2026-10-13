"""A synthetic recruiting site for the full-flow test. No real employer, account or personal data.

Server-side state stands in for a real ATS: login session, saved drafts, application history,
a per-account application limit and receipts. Custom dropdown and date controls only bind their
model when a real option/cell is clicked, so assigning input text does not count as a selection.
"""
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

JOBS = {
    '101': {'title': '合成AI产品经理', 'bu': '合成智能事业群', 'city': '合成中心城市',
            'jd': '职责：负责合成 AI 产品设计、Agent 需求与迭代。任职要求：必需：本科及以上学历；优先：有 AI 产品实习经验。'},
    '102': {'title': '合成数据产品经理', 'bu': '合成数据平台部', 'city': '合成中心城市',
            'jd': '职责：负责数据产品与 AI 能力落地。任职要求：必需：本科及以上学历。'},
}
LIMIT = 2

PAGE = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font:16px sans-serif;margin:24px;max-width:760px}}label{{display:block;margin-top:12px}}
.err{{color:#b00}}.combo-list,.cal{{border:1px solid #888;padding:4px;background:#fff}}
.combo-list[hidden],.cal[hidden],.modal[hidden]{{display:none}}.opt,.cell{{padding:4px;cursor:pointer}}
.modal{{position:fixed;inset:20% 10%;background:#fff;border:2px solid #333;padding:16px}}</style></head>
<body>{body}</body></html>"""

LOGIN = """<h1>合成招聘平台 · 登录</h1>
<form method="post" action="/login"><label for="acct">账号</label><input id="acct" name="acct" value="synthetic-user" readonly>
<label for="pw">密码</label><input id="pw" name="pw" type="password" value="prefilled-by-browser">
<button type="submit">登录</button></form>"""

CENTER = """<h1>申请中心</h1><p id="account">当前账号：synthetic-user</p>
<p id="rule">投递规则：每个账号最多投递 {limit} 个岗位，可同时进行；提交后不可修改志愿。（来源：合成平台投递须知）</p>
<h2>我的申请</h2><ul id="history">{history}</ul><p><a href="/jobs/101">合成AI产品经理</a> · <a href="/jobs/102">合成数据产品经理</a></p>"""

DETAIL = """<h1 id="title">{title}</h1><p id="bu">{bu}</p><p id="city">{city}</p><div id="jd">{jd}</div>
<p><a id="apply" href="/apply/{job}">申请该岗位</a></p>"""

APPLY = r"""<h1>申请：<span id="job-title">{title}</span></h1>
<div id="form-root"></div><p id="status" role="status"></p>
<div class="modal" id="confirm" hidden role="dialog" aria-label="确认投递">
<p id="confirm-text"></p><button type="button" id="confirm-ok">确认投递</button><button type="button" id="confirm-cancel">返回修改</button></div>
<script>
const JOB={job!r};
const model={{name:'',degree:'',grad:'',project:'',slot1:'',slot2:'',terms:false,resume:''}};
let gen=0;
const req=['name','degree','grad','project','slot1','terms','resume'];
function render(){{
  gen++; const g=gen;  // ids change on every render, like heavy SPA forms after parsing
  const root=document.getElementById('form-root');
  root.innerHTML=`
  <label for="name-${{g}}">姓名 *</label><input id="name-${{g}}" required>
  <label id="deg-label-${{g}}">学历 *</label>
  <div class="combo" role="combobox" aria-labelledby="deg-label-${{g}}" aria-expanded="false" aria-haspopup="listbox" tabindex="0" id="deg-${{g}}">
    <input readonly id="deg-input-${{g}}" aria-labelledby="deg-label-${{g}}" placeholder="请选择">
    <div class="combo-list" role="listbox" hidden id="deg-list-${{g}}"><div class="opt" role="option">本科</div><div class="opt" role="option">硕士</div></div></div>
  <label for="grad-${{g}}">毕业时间 *</label>
  <input readonly id="grad-${{g}}" class="date" placeholder="选择年月">
  <div class="cal" hidden id="cal-${{g}}"><div class="cell" role="button">2026-06</div><div class="cell" role="button">2026-07</div></div>
  <label for="resume-${{g}}">简历附件 *</label><input type="file" id="resume-${{g}}" accept=".pdf">
  <span id="resume-name">${{model.resume||'未上传'}}</span>
  <label for="project-${{g}}">项目经历 *</label><textarea id="project-${{g}}" maxlength="200"></textarea>
  <label for="slot1-${{g}}">第一意向部门 *</label><select id="slot1-${{g}}"><option value="">请选择</option><option>合成智能事业群</option><option>合成数据平台部</option></select>
  <label for="slot2-${{g}}">第二意向部门</label><select id="slot2-${{g}}"><option value="">不填</option><option>合成数据平台部</option></select>
  <label><input type="checkbox" id="terms-${{g}}"> 我已阅读并同意《合成隐私条款》 *</label>
  <p class="err" id="err"></p>
  <button type="button" id="save">保存草稿</button> <button type="button" id="submit">提交申请</button>`;
  const $=id=>document.getElementById(id+'-'+g);
  $('name').value=model.name; $('project').value=model.project; $('slot1').value=model.slot1; $('slot2').value=model.slot2;
  $('terms').checked=model.terms; $('deg-input').value=model.degree; $('grad').value=model.grad;
  $('name').addEventListener('input',e=>model.name=e.target.value);
  $('project').addEventListener('input',e=>model.project=e.target.value);
  $('slot1').addEventListener('change',e=>model.slot1=e.target.value);
  $('slot2').addEventListener('change',e=>model.slot2=e.target.value);
  $('terms').addEventListener('change',e=>model.terms=e.target.checked);
  const combo=$('deg'), list=$('deg-list');
  combo.addEventListener('click',()=>{{list.hidden=!list.hidden;combo.setAttribute('aria-expanded',String(!list.hidden))}});
  list.querySelectorAll('.opt').forEach(o=>o.addEventListener('click',ev=>{{ev.stopPropagation();model.degree=o.textContent;$('deg-input').value=model.degree;list.hidden=true}}));
  $('grad').addEventListener('click',()=>{{$('cal').hidden=false}});
  $('cal').querySelectorAll('.cell').forEach(c=>c.addEventListener('click',()=>{{model.grad=c.textContent;$('grad').value=model.grad;$('cal').hidden=true}}));
  $('resume').addEventListener('change',e=>{{const f=e.target.files[0];if(!f)return;model.resume=f.name;
     model.name='合成解析错误名'; // auto-parse pollutes a field and re-renders with new ids
     setTimeout(render,50)}});
  document.getElementById('save').onclick=async()=>{{
    const r=await fetch('/api/draft/'+JOB,{{method:'POST',body:JSON.stringify(model)}});
    document.getElementById('status').textContent=r.ok?'草稿已保存':'保存失败'}};
  document.getElementById('submit').onclick=()=>{{
    const missing=req.filter(k=>!model[k]);
    if(missing.length){{document.getElementById('err').textContent='请完成必填项：'+missing.join(',');return}}
    document.getElementById('confirm-text').textContent='确认投递：'+document.getElementById('job-title').textContent+'；第一意向：'+model.slot1+(model.slot2?'；第二意向：'+model.slot2:'');
    document.getElementById('confirm').hidden=false}};
}}
document.getElementById('confirm-cancel').onclick=()=>{{document.getElementById('confirm').hidden=true}};
document.getElementById('confirm-ok').onclick=async()=>{{
  const r=await fetch('/api/submit/'+JOB,{{method:'POST',body:JSON.stringify(model)}});
  const data=await r.json(); if(r.ok) location.href='/receipt/'+data.application_id;
  else document.getElementById('err').textContent=data.error}};
(async()=>{{const r=await fetch('/api/draft/'+JOB);if(r.ok){{Object.assign(model,await r.json())}};render()}})();
</script>"""

RECEIPT = """<h1>投递成功</h1><p id="receipt">申请编号：<b id="app-id">{app_id}</b>（{title}）</p><p><a href="/center">返回申请中心</a></p>"""


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.drafts, self.history = {}, []


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, body, kind='text/html; charset=utf-8', headers=None):
            data = body.encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def logged_in(self):
            return 'session=synthetic' in (self.headers.get('Cookie') or '')

        def page(self, title, body):
            self.send(200, PAGE.format(title=title, body=body))

        def do_GET(self):
            path = urlsplit(self.path).path
            parts = path.strip('/').split('/')
            if path == '/login':
                return self.page('登录', LOGIN)
            if not self.logged_in():
                return self.send(302, '', headers={'Location': '/login'})
            if path == '/center':
                items = ''.join('<li class="app">{0} · {1} · {2}</li>'.format(h['application_id'], JOBS[h['job']]['title'], h['slot1'])
                                for h in state.history)
                return self.page('申请中心', CENTER.format(limit=LIMIT, history=items or '<li>暂无</li>'))
            if parts[0] == 'jobs' and len(parts) == 2 and parts[1] in JOBS:
                return self.page(JOBS[parts[1]]['title'], DETAIL.format(job=parts[1], **JOBS[parts[1]]))
            if parts[0] == 'apply' and len(parts) == 2 and parts[1] in JOBS:
                return self.page('申请', APPLY.format(job=parts[1], title=JOBS[parts[1]]['title']))
            if parts[0] == 'receipt' and len(parts) == 2:
                match = [h for h in state.history if h['application_id'] == parts[1]]
                if match:
                    return self.page('投递成功', RECEIPT.format(app_id=parts[1], title=JOBS[match[0]['job']]['title']))
            if parts[:2] == ['api', 'draft'] and len(parts) == 3:
                with state.lock:
                    draft = state.drafts.get(parts[2])
                return self.send(200, json.dumps(draft), 'application/json') if draft else self.send(404, '{}', 'application/json')
            if path == '/api/history':
                return self.send(200, json.dumps(state.history, ensure_ascii=False), 'application/json')
            self.send(404, 'not found')

        def do_POST(self):
            path = urlsplit(self.path).path
            parts = path.strip('/').split('/')
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode('utf-8')
            if path == '/login':
                # A persistent login cookie, as most ATS sites set, so a persistent browser profile keeps it.
                return self.send(302, '', headers={'Location': '/center', 'Set-Cookie': 'session=synthetic; Path=/; Max-Age=86400'})
            if not self.logged_in():
                return self.send(401, '{}', 'application/json')
            if parts[:2] == ['api', 'draft'] and len(parts) == 3:
                with state.lock:
                    state.drafts[parts[2]] = json.loads(body)
                return self.send(200, '{"saved":true}', 'application/json')
            if parts[:2] == ['api', 'submit'] and len(parts) == 3:
                form = json.loads(body)
                with state.lock:
                    if len(state.history) >= LIMIT:
                        return self.send(409, json.dumps({'error': '已达投递上限'}, ensure_ascii=False), 'application/json')
                    if any(h['job'] == parts[2] for h in state.history):
                        return self.send(409, json.dumps({'error': '该岗位已投递'}, ensure_ascii=False), 'application/json')
                    app_id = 'APP-' + uuid.uuid4().hex[:8].upper()
                    state.history.append({'application_id': app_id, 'job': parts[2], 'slot1': form.get('slot1', '')})
                return self.send(200, json.dumps({'application_id': app_id}), 'application/json')
            self.send(404, '{}', 'application/json')
    return Handler


def serve():
    """Start the site on a free localhost port; returns (base_url, state, server)."""
    state = State()
    server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(state))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d' % server.server_address[1], state, server
