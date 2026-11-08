"""Read actual MCP identity; reject stale business calls before execution."""
import hashlib,json,os
from pathlib import Path

def installed_release(package):
    package=Path(package);files=['package.json','package-lock.json']
    for name in ['shared','login','application','catalog','host']:
        files += [name+'/'+p.name for p in (package/name).iterdir() if p.suffix in {'.mjs','.json'}]
    digest=hashlib.sha256()
    for name in sorted(files):digest.update(name.encode());digest.update(b'\0');digest.update((package/name).read_bytes())
    return {'version':json.loads((package/'package.json').read_text())['version'],'sourceFingerprint':digest.hexdigest()}

def runtime_data(value):
    if isinstance(value,str):
        try:return runtime_data(json.loads(value))
        except ValueError:return None
    if not isinstance(value,dict):return None
    if isinstance(value.get('runtime'),dict) and value.get('version'):return value
    for key in ['result','data','structuredContent','output']:
        found=runtime_data(value.get(key))
        if found:return found
    for block in value.get('content',[]):
        if isinstance(block,dict) and block.get('type')=='text':
            found=runtime_data(block.get('text'))
            if found:return found
    return None

def check_runtime(event,package,state,stages,write):
    tool=event.get('tool_name','').replace('-','_')
    mode='application' if 'recruiting_application_v2' in tool else 'login' if 'recruiting_login_v2' in tool else None
    if not mode or event.get('component_cli'):return
    session=event.get('session_id')
    if not session:return
    file=Path(state)/'runtime-identities.json';key=session+':'+mode
    try:records=json.loads(file.read_text())
    except FileNotFoundError:records={}
    operation=tool.split('__')[-1]
    if event.get('hook_event_name')=='PostToolUse' and operation=='runtime_info':
        data=runtime_data(event.get('tool_response',event.get('tool_result',event.get('output'))))
        if data:
            records[key]={'version':data['version'],'sourceFingerprint':data['runtime'].get('sourceFingerprint'),'processId':data['runtime'].get('processId')}
            Path(state).mkdir(parents=True,exist_ok=True);write(file,records)
    if event.get('hook_event_name')=='PreToolUse' and operation in stages:
        expected=installed_release(package);actual=records.get(key)
        if not actual:raise ValueError('MCP_RUNTIME_IDENTITY_REQUIRED: 先用runtime_info读取本连接实际版本')
        if any(actual.get(k)!=v for k,v in expected.items()):raise ValueError('MCP_RUNTIME_VERSION_MISMATCH: '+str(actual.get('version'))+' -> '+expected['version']+'；本连接尚未加载当前部署，业务调用未执行')
        try:os.kill(int(actual['processId']),0)
        except (ProcessLookupError,ValueError,TypeError,KeyError):raise ValueError('MCP_RUNTIME_IDENTITY_EXPIRED: 连接变化后重读runtime_info')
