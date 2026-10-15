"""Five isolated ATS templates with server-validated drafts and receipts. Synthetic facts only.

Visible labels drive the mapper. The EXPECTED manifest is used exclusively as a test oracle.
Custom widgets update their backing model only after a real option/date click.
"""
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PROFILE = {'name': '合成候选人', 'phone': '00000000000', 'email': 'candidate@example.test',
           'bachelor.school': '合成本科大学', 'master.school': '合成硕士大学', 'degree': '本科',
           'graduation': '2026-06', 'project': '合成项目：设计需求、验证交互并记录测试结果。'}
SITES = ['native-bilingual', 'search-dropdown', 'date-cascade', 'repeated-education', 'upload-rerender']
EXPECTED = {
    'native-bilingual': ['name', 'phone', 'email', 'bachelor.school', 'degree', 'project'],
    'search-dropdown': ['name', 'bachelor.school', 'degree', 'project'],
    'date-cascade': ['name', 'bachelor.school', 'graduation', 'project'],
    'repeated-education': ['name', 'bachelor.school', 'master.school', 'project'],
    'upload-rerender': ['name', 'bachelor.school', 'project', 'resume'],
}


def page_html(site, generation):
    def text(key, label, multiline=False, group=''):
        ident = key.replace('.', '-') + '-' + str(generation)
        tag = 'textarea' if multiline else 'input'
        extra = ' maxlength="200"' if multiline else ''
        return f'<label for="{ident}">{label} *</label><{tag} id="{ident}" data-key="{key}" required{extra}></{tag}>'

    name = text('name', 'Full name' if site == 'native-bilingual' else '姓名')
    project = text('project', '项目经历', True)
    school = text('bachelor.school', '本科毕业院校')
    if site == 'native-bilingual':
        body = name + text('phone', 'Mobile phone') + text('email', 'Email address') + school + \
            '<label for="degree">Degree *</label><select required id="degree" data-key="degree"><option></option><option>本科</option><option>硕士</option></select>' + project
    elif site == 'search-dropdown':
        body = name + '''<label id="school-label">本科毕业院校 *</label>
        <div class="el-select" id="school-widget" role="combobox" aria-labelledby="school-label" aria-required="true" aria-controls="schools" tabindex="0">
        <input id="school-search" aria-labelledby="school-label" placeholder="搜索学校"><div role="listbox" id="schools" hidden>
        <button type="button" role="option">合成本科大学</button><button type="button" role="option">合成本科大学继续教育学院</button></div></div>
        <label for="degree">学历 *</label><select required id="degree" data-key="degree"><option></option><option>本科</option><option>硕士</option></select>''' + project
    elif site == 'date-cascade':
        body = name + '''<label id="school-label">本科毕业院校 *</label>
        <div class="el-cascader" id="cascade" aria-labelledby="school-label"><input id="school-readback" aria-labelledby="school-label" readonly>
        <div id="levels" hidden><button type="button" role="option" id="level-one">合成省</button><button type="button" role="option" id="level-two" hidden>合成本科大学</button></div></div>
        <label for="graduation">毕业时间 *</label><div class="el-date-editor"><input id="graduation" readonly required>
        <div id="calendar" hidden><button type="button" id="date-cell">2026-06</button></div></div>''' + project
    elif site == 'repeated-education':
        body = name + '<fieldset><legend>本科教育经历</legend>' + text('bachelor.school', '就读院校') + '</fieldset>' + \
            '<fieldset><legend>硕士教育经历（在读）</legend>' + text('master.school', '就读院校') + '</fieldset>' + project
    else:
        body = '<label for="resume">简历附件 *</label><input id="resume" type="file" accept=".pdf" required><span id="filename"></span><div id="parsed">' + name + school + project + '</div>'
    # The namespace is a fixture implementation detail, never passed to semantic mapping.
    return '''<!doctype html><html lang="zh"><meta charset="utf-8"><title>合成ATS · ''' + site + '''</title>
    <style>body{font:16px system-ui;max-width:860px;margin:28px auto}label{display:block;margin:14px 0 4px}input,textarea,select{padding:8px;width:90%}button{padding:8px;margin:8px}fieldset{margin:16px 0}[hidden]{display:none!important}.err{color:#a11}nav{padding:12px;background:#eef3fb}</style>
    <nav>合成招聘 · 岗位详情 · 申请进度 · 帮助中心</nav><h1>合成岗位申请</h1><p>请核对材料。每次最终投递需先审核当前表单。</p>
    <form id="application">''' + body + '''<p class="err" id="error" role="alert"></p>
    <button type="button" id="save">保存草稿</button><button type="button" id="submit">提交申请</button></form>
    <p id="status" role="status"></p><section id="receipt" hidden></section><script>
    const site=''' + json.dumps(site) + ''', model={};
    function bind(){document.querySelectorAll('[data-key]').forEach(e=>{e.addEventListener(e.tagName==='SELECT'?'change':'input',()=>{model[e.dataset.key]=e.value})})}bind();
    const $=id=>document.getElementById(id);
    if(site==='search-dropdown'){
      $('school-widget').onclick=()=>{$('schools').hidden=false};
      $('school-search').oninput=()=>{delete model['bachelor.school']};
      $('schools').querySelectorAll('[role="option"]').forEach(o=>o.onclick=ev=>{ev.stopPropagation();model['bachelor.school']=o.textContent;$('school-search').value=o.textContent;$('schools').hidden=true});
    }
    if(site==='date-cascade'){
      $('cascade').onclick=()=>{$('levels').hidden=false};
      $('level-one').onclick=ev=>{ev.stopPropagation();$('level-two').hidden=false;delete model['bachelor.school'];$('school-readback').value=''};
      $('level-two').onclick=ev=>{ev.stopPropagation();model['bachelor.school']=ev.target.textContent;$('school-readback').value=ev.target.textContent;$('levels').hidden=true};
      $('graduation').onclick=()=>{$('calendar').hidden=false};
      $('date-cell').onclick=()=>{model.graduation='2026-06';$('graduation').value='2026-06';$('calendar').hidden=true};
    }
    if(site==='upload-rerender'){$('resume').onchange=e=>{
      model.resume=e.target.files[0].name;$('filename').textContent=model.resume;
      const old=$('parsed'), fresh=old.cloneNode(true);old.replaceWith(fresh);
      fresh.querySelectorAll('[data-key]').forEach(el=>{el.id+='-parsed';el.value='';delete model[el.dataset.key]});
      fresh.querySelectorAll('label').forEach(l=>l.htmlFor+='-parsed');bind();$('status').textContent='解析完成';
    }}
    async function post(kind){const r=await fetch('/api/'+kind+'/'+site,{method:'POST',body:JSON.stringify(model)}),data=await r.json();
      if(!r.ok){$('error').textContent=data.error;return}
      $('error').textContent='';$('status').textContent=kind==='draft'?'草稿已保存':'投递成功';
      if(kind==='submit'){$('receipt').hidden=false;$('receipt').textContent='申请编号：'+data.receipt}
    }
    $('save').onclick=()=>post('draft');$('submit').onclick=()=>post('submit');
    </script></html>'''


def serve():
    state = {'drafts': {}, 'receipts': {}, 'generation': 0, 'lock': threading.Lock()}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, body, mime='application/json'):
            payload = body.encode('utf-8')
            self.send_response(code); self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith('/forms/') and path.rsplit('/', 1)[-1] in SITES:
                with state['lock']:
                    state['generation'] += 1
                    html = page_html(path.rsplit('/', 1)[-1], state['generation'])
                self.send(200, html, 'text/html')
            elif path.startswith('/api/draft/'):
                self.send(200, json.dumps(state['drafts'].get(path.rsplit('/', 1)[-1], {}), ensure_ascii=False))
            elif path.startswith('/api/receipt/'):
                receipt = state['receipts'].get(path.rsplit('/', 1)[-1])
                self.send(200 if receipt else 404, json.dumps(receipt or {}))
            else:
                self.send(404, '{}')

        def do_POST(self):
            path = urlsplit(self.path).path
            parts = path.split('/')
            if len(parts) != 4 or parts[1] != 'api' or parts[2] not in ('draft', 'submit') or parts[3] not in SITES:
                return self.send(404, '{}')
            kind, site = parts[2:]
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length > 64000:
                    return self.send(413, '{}')
                data = json.loads(self.rfile.read(length))
            except (ValueError, TypeError):
                return self.send(400, '{}')
            wrong = [k for k in EXPECTED[site] if data.get(k) != ('synthetic-resume.pdf' if k == 'resume' else PROFILE[k])]
            if wrong:
                return self.send(422, json.dumps({'error': '缺失或组件未绑定：' + ','.join(wrong)}, ensure_ascii=False))
            with state['lock']:
                if kind == 'draft':
                    state['drafts'][site] = data
                    result = {'saved': True}
                else:
                    receipt = 'mock-' + uuid.uuid4().hex[:12]
                    state['receipts'][receipt] = {'site': site, 'values': data}
                    result = {'receipt': receipt}
            self.send(200, json.dumps(result))

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state, 'http://127.0.0.1:' + str(server.server_port)


if __name__ == '__main__':
    server, _, base = serve()
    print(base, flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown(); server.server_close()
