#!/usr/bin/env python3
"""填写方案.json: the per-role fill cache (field map + values or value sources + per-field progress).

It is a cache for filling one form fast and resuming after an interruption. It is NOT a state
record: 盘点状态 / 投递状态 live only in the Excel tracker, approvals and receipts only in Markdown
evidence. Every key is whitelisted, so status, receipt or approval fields cannot creep in.

  fill_plan.py check    <方案.json> [--ready]                 structure (and execution readiness)
  fill_plan.py skeleton <控件盘点.json> --batch B --company C --url U --lane L --out <方案.json>
  fill_plan.py from-template <站点模板.json> --batch B --company C --url U --lane L --out <方案.json>
  fill_plan.py template <方案.json> --out <站点模板.json>      reusable map: no values, no progress
  fill_plan.py pending  <方案.json>                           fields still to do (resume list)
  fill_plan.py actions  <方案.json> [--vault 档案.md] [--root R] in-app / Chrome batch action list
  fill_plan.py mark     <方案.json> --field N --status 已读回 [--readback TEXT] [--vault 档案.md]
  fill_plan.py vault-sync <方案.json> --vault <档案.md>          需用户 fields whose 档案 value now exists → 待填
  fill_plan.py page-check <方案.json> --ok yes|no --observation <截图或读回文件>   page-level validation seen now
  fill_plan.py export   <方案.json> [--out 填写读回.md]          readback evidence bound to the plan hash
  (skeleton / from-template / check accept --workbook <追踪表.xlsx>: the Excel row must exist once and be 待投递)

Sensitive fields (phone, e-mail, address, contacts…) keep a 值来源 reference (档案:<字段>) instead of
the literal value, and their 读回 is only 一致 / 不一致. Passwords, verification codes and ID/bank
numbers are never in the plan: those fields are 填法 用户. Anything that looks like a mobile
number, ID number or e-mail address stored as a literal value is rejected, and so are links that
carry credentials or tokens. Export needs a page-level check and read-backs from the last 15 minutes.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from submit_words import submit_like_text  # noqa: E402
from workbook_state import canonical_url  # noqa: E402

PLAN_NAME = '填写方案.json'
VERSION = 1
TOP_KEYS = {'方案版本', '批次', '公司', '岗位链接', '表单链接', '通道', '站点模板', '生成时间', '更新时间', '字段', '保存步骤',
            '页面校验', '备注'}
CHECK_KEYS = {'结果', '时间', '观察', '说明'}
FRESH_MINUTES = 15
FIELD_KEYS = {'序号', '标签', '定位', '控件', '填法', '值', '值来源', '点击步骤', '读回定位', '读回方式', '必填', '依赖',
              '状态', '读回', '更新时间', '备注'}
TEMPLATE_KEYS = {'模板版本', '站点', '说明', '字段', '保存步骤'}
CONTROLS = ('文本', '多行文本', '原生下拉', '下拉', '多选下拉', '级联', '日期', '单选', '复选', '上传', '其他')
METHODS = ('批量', '点击', '上传', '用户')
BATCHABLE = ('文本', '多行文本', '原生下拉', '单选', '复选')
STATES = ('待填', '已填', '已读回', '不一致', '需用户', '跳过')
DONE = ('已读回', '跳过')
LANES = ('内置浏览器', 'Chrome', 'Playwright')
LOCATOR_KEYS = ('label', 'role', 'css', 'text', 'placeholder')
READBACK_MODES = ('值', '文本', '勾选', '选中项')
SENSITIVE = re.compile(r'(手机|电话|联系方式|邮箱|e-?mail|mobile|phone|contact|address|date.?of.?birth|住址|地址|家庭|紧急联系人|微信|qq|出生|生日|民族|政治面貌|婚|健康|宗教)', re.I)
NEVER = re.compile(r'(密码|口令|验证码|校验码|动态码|身份证|证件号|护照|银行卡|卡号|cookie|token|password|otp|captcha)', re.I)
SOURCE = re.compile(r'^(档案|材料):\s*(.+)$')
PII_LITERAL = re.compile(r'(?<!\d)(?:1[3-9]\d{9}|\d{17}[\dXx])(?![\dA-Za-z])|[\w.+-]+@[\w-]+\.[\w.-]+')
URL_SECRET = re.compile(r'(token|passw|pwd|secret|session|sid|auth|ticket|code|sig|key|cookie)', re.I)


def now():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec='seconds')


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, plan):
    """Atomic write so an interruption never leaves a half-written cache."""
    path = Path(path)
    plan['更新时间'] = now()
    data = json.dumps(plan, ensure_ascii=False, indent=2) + '\n'
    fd, tmp = tempfile.mkstemp(prefix='.fill-', suffix='.json', dir=str(path.parent))
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(data)
    os.replace(tmp, path)


def plan_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sensitive(field):
    return bool(SENSITIVE.search(str(field.get('标签', ''))))


def never_store(field):
    return bool(NEVER.search(str(field.get('标签', ''))))


# ---------------------------------------------------------------- validation
def locator_errors(spec, where):
    if not isinstance(spec, dict):
        return [where + ' 必须是对象，例如 {"label": "姓名 *"}']
    keys = [k for k in LOCATOR_KEYS if spec.get(k)]
    extra = set(spec) - set(LOCATOR_KEYS) - {'name', 'exact', 'nth'}
    errors = []
    if len(keys) != 1:
        errors.append(where + ' 需要且只需要 label / role / css / text / placeholder 之一')
    if extra:
        errors.append(where + ' 有未知键 ' + '、'.join(sorted(extra)))
    if spec.get('role') and not spec.get('name'):
        errors.append(where + ' 用 role 定位时需要 name')
    for k in ('label', 'name', 'text'):
        if submit_like_text(spec.get(k, '')):
            errors.append(where + ' 指向疑似最终提交的控件：填写方案不能包含提交点击')
    return errors


def steps_errors(steps, where):
    if not isinstance(steps, list) or not steps:
        return [where + ' 需要非空列表']
    errors = []
    for i, step in enumerate(steps, 1):
        here = '%s 第 %d 步' % (where, i)
        if not isinstance(step, dict) or len(step) != 1:
            errors.append(here + ' 必须是 {"点击": 定位} / {"选项": "文字"} / {"等待": 毫秒} 之一')
            continue
        (kind, arg), = step.items()
        if kind == '点击':
            errors.extend(locator_errors(arg, here))
        elif kind == '选项':
            if not isinstance(arg, str) or not arg.strip():
                errors.append(here + ' 的选项文字为空')
            elif submit_like_text(arg):
                errors.append(here + ' 的选项像最终提交按钮')
        elif kind == '等待':
            if not isinstance(arg, int) or not 0 <= arg <= 10000:
                errors.append(here + ' 的等待须为 0–10000 毫秒')
        else:
            errors.append(here + ' 未知动作「' + str(kind) + '」')
    return errors


def field_errors(field, index, ready=False):
    where = '字段 %s' % field.get('序号', index) if isinstance(field, dict) else '字段 %d' % index
    if not isinstance(field, dict):
        return [where + ' 必须是对象']
    errors = []
    extra = set(field) - FIELD_KEYS
    if extra:
        errors.append(where + ' 有不属于填写缓存的键 ' + '、'.join(sorted(extra)) + '（投递状态写 Excel，确认与回执写 Markdown 证据）')
    if not isinstance(field.get('序号'), int):
        errors.append(where + ' 需要整数「序号」')
    if not str(field.get('标签', '')).strip():
        errors.append(where + ' 需要「标签」')
    errors.extend(locator_errors(field.get('定位'), where + ' 的定位'))
    control, method, state = field.get('控件'), field.get('填法'), field.get('状态', '待填')
    if control not in CONTROLS:
        errors.append(where + ' 的控件须为 ' + '/'.join(CONTROLS))
    if method not in METHODS:
        errors.append(where + ' 的填法须为 ' + '/'.join(METHODS))
    if state not in STATES:
        errors.append(where + ' 的状态须为 ' + '/'.join(STATES))
    if method == '批量' and control not in BATCHABLE:
        errors.append(where + '：' + str(control) + ' 不能批量填写，须用真实点击（填法: 点击）')
    if method == '上传' and control != '上传':
        errors.append(where + '：只有上传控件用「填法: 上传」')
    if control == '上传' and method not in ('上传', '用户'):
        errors.append(where + '：上传控件用「填法: 上传」')
    if method == '点击':
        errors.extend(steps_errors(field.get('点击步骤'), where + ' 的点击步骤'))
        if '读回定位' not in field:
            errors.append(where + ' 用点击填写时需要「读回定位」（显示选中结果的元素）')
    if '读回定位' in field:
        errors.extend(locator_errors(field.get('读回定位'), where + ' 的读回定位'))
    if field.get('读回方式') not in (None, *READBACK_MODES):
        errors.append(where + ' 的读回方式须为 ' + '/'.join(READBACK_MODES))
    raw, source = field.get('值'), field.get('值来源')
    if raw is not None and not isinstance(raw, (str, bool)):
        errors.append(where + ' 的值须为文字或 true/false')
    if source is not None and not (source == '用户' or (isinstance(source, str) and SOURCE.match(source))):
        errors.append(where + ' 的值来源须为「档案:<字段>」「材料:<名称>」或「用户」')
    for key in ('标签', '值', '值来源', '读回', '备注'):
        if isinstance(field.get(key), str) and PII_LITERAL.search(field[key]):
            errors.append(where + ' 的「' + key + '」疑似含手机号/证件号/邮箱明文：改用「值来源: 档案:<字段>」，读回只写 一致/不一致')
            break
    if PII_LITERAL.search(json.dumps(field.get('定位'), ensure_ascii=False)):
        errors.append(where + ' 的定位疑似含个人信息明文')
    if never_store(field):
        if method != '用户' or raw not in (None, '') or source not in (None, '用户'):
            errors.append(where + '（' + str(field.get('标签')) + '）属于永不记录的信息：填法须为「用户」，不写值')
        if field.get('读回') not in (None, '', '一致', '不一致'):
            errors.append(where + ' 的读回只能写 一致/不一致，不复述内容')
    elif sensitive(field):
        if raw not in (None, '') and not isinstance(raw, bool):
            errors.append(where + '（' + str(field.get('标签')) + '）是个人敏感信息：用「值来源: 档案:<字段>」，不把明文写进方案')
        if field.get('读回') not in (None, '', '一致', '不一致'):
            errors.append(where + ' 是敏感字段：读回只写 一致/不一致')
    if ready and method not in ('用户',) and state not in DONE and raw in (None, '') and not source:
        errors.append(where + ' 还没有值或值来源，不能执行')
    if state == '跳过' and field.get('必填'):
        errors.append(where + ' 是必填项，不能「跳过」')
    deps = field.get('依赖', [])
    if not isinstance(deps, list) or not all(isinstance(d, int) for d in deps):
        errors.append(where + ' 的依赖须为序号列表')
    return errors


def validate(plan, ready=False):
    if not isinstance(plan, dict):
        return ['填写方案必须是 JSON 对象']
    errors = []
    extra = set(plan) - TOP_KEYS
    if extra:
        errors.append('填写方案有不属于填写缓存的键 ' + '、'.join(sorted(extra)) + '（状态只写 Excel，确认与回执只写 Markdown 证据）')
    if plan.get('方案版本') != VERSION:
        errors.append('方案版本须为 %d' % VERSION)
    for key in ('批次', '公司', '岗位链接'):
        if not str(plan.get(key, '')).strip():
            errors.append('填写方案需要「' + key + '」')
    if plan.get('通道') not in LANES:
        errors.append('填写方案的通道须为 ' + '/'.join(LANES))
    for key in ('岗位链接', '表单链接'):
        if key in plan:
            parts = urlsplit(str(plan.get(key) or ''))
            if parts.username or parts.password or any(URL_SECRET.search(k) for k, _ in parse_qsl(parts.query)):
                errors.append('「' + key + '」带有登录凭据或令牌参数：去掉后再保存')
    check = plan.get('页面校验')
    if check is not None and (not isinstance(check, dict) or set(check) - CHECK_KEYS or check.get('结果') not in ('通过', '不通过')):
        errors.append('页面校验须为 {"结果": "通过/不通过", "时间": ..., "观察": ...}')
    fields = plan.get('字段')
    if not isinstance(fields, list) or not fields:
        return errors + ['填写方案需要非空「字段」列表']
    seen, targets = set(), {}
    for i, field in enumerate(fields, 1):
        errors.extend(field_errors(field, i, ready))
        if isinstance(field, dict):
            seq = field.get('序号')
            if isinstance(seq, int):
                if seq in seen:
                    errors.append('序号 %s 重复' % seq)
                seen.add(seq)
            key = json.dumps(field.get('定位'), ensure_ascii=False, sort_keys=True)
            if key in targets:
                errors.append('字段 %s 与字段 %s 指向同一个控件（%s）：合并成一个字段' % (field.get('序号'), targets[key], key))
            targets.setdefault(key, field.get('序号'))
    for field in fields:
        if isinstance(field, dict):
            for dep in field.get('依赖', []) if isinstance(field.get('依赖', []), list) else []:
                if isinstance(dep, int) and dep not in seen:
                    errors.append('字段 %s 依赖的序号 %s 不存在' % (field.get('序号'), dep))
    if '保存步骤' in plan:
        errors.extend(steps_errors(plan['保存步骤'], '保存步骤'))
    return errors


def validate_template(template):
    if not isinstance(template, dict):
        return ['站点模板必须是 JSON 对象']
    errors = []
    extra = set(template) - TEMPLATE_KEYS
    if extra:
        errors.append('站点模板有未知键 ' + '、'.join(sorted(extra)))
    fields = template.get('字段')
    if not isinstance(fields, list) or not fields:
        return errors + ['站点模板需要非空「字段」列表']
    for i, field in enumerate(fields, 1):
        if isinstance(field, dict):
            for key in ('值', '读回', '状态', '更新时间'):
                if key in field:
                    errors.append('站点模板字段 %s 不能有「%s」：模板只描述表单，不带个人取值和进度' % (field.get('序号', i), key))
            stripped = {k: v for k, v in field.items() if k not in ('值', '读回', '状态', '更新时间')}
            errors.extend(field_errors(dict(stripped, 状态='待填'), i))
        else:
            errors.append('站点模板字段 %d 必须是对象' % i)
    if '保存步骤' in template:
        errors.extend(steps_errors(template['保存步骤'], '保存步骤'))
    return errors


# ---------------------------------------------------------------- building
INVENTORY_KIND = {'file': ('上传', '上传'), 'cascader': ('级联', '点击'), 'date_picker': ('日期', '点击'),
                  'multi_select': ('多选下拉', '点击')}


def from_inventory(inventory, batch, company, url, lane):
    """Skeleton plan from inspect_form_controls.js output; values stay empty until filled in."""
    fields = []
    entries = [c for c in inventory.get('fields', []) if isinstance(c, dict)]
    labels = {}
    for c in entries:
        if c.get('label') and c.get('kind') not in ('readonly_input', 'unknown', 'button', None):
            labels.setdefault(c['label'].strip(), c.get('kind'))
    for c in entries:
        kind = c.get('kind')
        if kind in ('button', None):
            continue
        if kind in ('readonly_input', 'unknown') and (c.get('label') or '').strip() in labels:
            continue  # the display input inside a custom dropdown/date widget already listed under the same label
        evidence = ' '.join(c.get('evidence') or [])
        label = (c.get('label') or '').strip()
        if kind == 'text':
            control = '多行文本' if evidence.startswith('textarea') else '文本'
            method = '批量'
        elif kind == 'select':
            native = evidence.startswith('select')
            control, method = ('原生下拉', '批量') if native else ('下拉', '点击')
        elif kind in ('checkbox', 'radio'):
            native = 'input_type=' + kind in evidence
            control = '复选' if kind == 'checkbox' else '单选'
            method = '批量' if native else '点击'
        elif kind in INVENTORY_KIND:
            control, method = INVENTORY_KIND[kind]
        else:
            control, method = '其他', '用户'
        label_unique = sum((entry.get('label') or '').strip() == label for entry in entries if entry.get('kind') != 'button') == 1
        locator = {'label': label} if label and label_unique and c.get('labelSource') in ('label', 'aria-labelledby', 'aria-label') else {'css': c.get('controlLocator') or c.get('locator') or 'body'}
        field = {'序号': len(fields) + 1, '标签': label or ('未识别标签 ' + str(c.get('index'))), '定位': locator,
                 '控件': control, '填法': method, '必填': bool(c.get('required')), '状态': '待填'}
        if method == '点击':
            field['点击步骤'] = [{'点击': locator}]
            field['读回定位'] = locator
            field['备注'] = '补全点击步骤（打开后点击实际选项/日期单元）'
        if never_store(field):
            field.update({'填法': '用户', '状态': '需用户'})
            field.pop('点击步骤', None)
        fields.append(field)
    plan = {'方案版本': VERSION, '批次': batch, '公司': company, '岗位链接': url, '通道': lane,
            '生成时间': now(), '字段': fields}
    upload_first(plan)
    return plan


def upload_first(plan):
    """Uploads that auto-parse go first, then everything is filled/corrected after them."""
    fields = plan['字段']
    fields.sort(key=lambda f: (0 if f.get('控件') == '上传' else 1, f.get('序号', 0)))
    mapping = {}
    for i, f in enumerate(fields, 1):
        mapping[f['序号']] = i
        f['序号'] = i
    for f in fields:
        f['依赖'] = [mapping[d] for d in f.get('依赖', []) if d in mapping]
        if not f['依赖']:
            f.pop('依赖')


def to_template(plan, site=None):
    fields = []
    for f in plan.get('字段', []):
        t = {k: v for k, v in f.items() if k not in ('值', '读回', '状态', '更新时间')}
        if f.get('值来源') is None and f.get('值') not in (None, ''):
            t['备注'] = (t.get('备注', '') + ' 取值随岗位/用户而定').strip()
        fields.append(t)
    host = site or urlsplit(plan.get('表单链接') or plan.get('岗位链接') or '').hostname or '未知站点'
    template = {'模板版本': 1, '站点': host, '说明': '由 ' + str(plan.get('公司')) + ' 的填写方案提炼；不含个人取值与进度', '字段': fields}
    if plan.get('保存步骤'):
        template['保存步骤'] = plan['保存步骤']
    return template


def from_template(template, batch, company, url, lane):
    fields = [dict(f, 状态='需用户' if f.get('填法') == '用户' else '待填') for f in template['字段']]
    plan = {'方案版本': VERSION, '批次': batch, '公司': company, '岗位链接': url, '通道': lane,
            '站点模板': template.get('站点'), '生成时间': now(), '字段': fields}
    if template.get('保存步骤'):
        plan['保存步骤'] = template['保存步骤']
    return plan


# ---------------------------------------------------------------- values
def vault_values(path):
    """档案 lookup: Markdown table rows `| 字段 | 取值 | …` and `字段: 值` lines."""
    values = {}
    if not path:
        return values
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')] if line.strip().startswith('|') else []
        if len(cells) >= 2 and cells[0] and cells[1] and not set(cells[0]) <= set('-: ') and cells[0] not in ('字段', '类型', '用途'):
            values.setdefault(cells[0], cells[1])
        m = re.match(r'^\s*[-*]?\s*([^:：|#]{1,40})[:：]\s*(.+?)\s*$', line)
        if m:
            values.setdefault(m.group(1).strip(), m.group(2).strip())
    return values


def materials(root, batch):
    """材料 from 投递证据/<批次>/批次/Query.md: name → path relative to the application root."""
    from evidence_layout import batch_dir, parse, list_items
    _, lines = parse(batch_dir(root, batch) / '批次' / 'Query.md')
    return {item[0]: item[1] for item in list_items(lines.get('材料', [])) if len(item) >= 2}


def privacy_enabled(root, batch):
    """Sensitive fields are filled by the Agent only when this batch enabled privacy-info-fill."""
    if not (root and batch):
        return False
    from evidence_layout import batch_dir, parse, value
    q, _ = parse(batch_dir(root, batch) / '批次' / 'Query.md')
    return 'privacy-info-fill' in value(q, '已开启', '自动化授权')


def blocked_reason(field, vault=None, root=None, batch=None, privacy=None):
    """Why the Agent cannot fill this field now (None = it can)."""
    if field.get('填法') == '用户' or field.get('值来源') == '用户':
        return '由用户本人填写'
    if sensitive(field) and not (privacy if privacy is not None else privacy_enabled(root, batch)):
        return '本批未开启 privacy-info-fill：敏感字段交用户'
    if field.get('值') not in (None, ''):
        return None
    m = SOURCE.match(field.get('值来源') or '')
    if not m:
        return '没有值或值来源'
    kind, key = m.group(1), m.group(2).strip()
    if kind == '档案' and key not in (vault or {}):
        return '档案里没有「' + key + '」：问用户后用 profile_vault.py add 写进档案'
    if kind == '材料' and key not in (materials(root, batch) if root and batch else {}):
        return 'Query 材料节没有「' + key + '」'
    return None


def resolve(field, vault=None, root=None, batch=None, privacy=None):
    """The value to put in a field, or None when the Agent cannot fill it (see blocked_reason)."""
    if blocked_reason(field, vault, root, batch, privacy):
        return None
    if field.get('值') not in (None, ''):
        return field['值']
    kind, key = SOURCE.match(field['值来源']).groups()
    key = key.strip()
    if kind == '档案':
        return vault[key]
    rel = materials(root, batch)[key]
    return str((Path(root) / rel.replace('\\', '/')).resolve())


def bind(plan, workbook):
    """Read-only: the plan's role must be exactly one Excel row of the same company, still 待投递."""
    from workbook_state import Workbook
    rows = Workbook(workbook).role_by_url(str(plan.get('岗位链接') or ''))
    if len(rows) != 1:
        return ['Excel 里找不到唯一的这条岗位链接（%d 行）：先把岗位行写进 Excel' % len(rows)]
    errors = []
    if rows[0].get('公司') != plan.get('公司'):
        errors.append('填写方案的公司与 Excel 行不一致')
    if rows[0].get('投递状态') != '待投递':
        errors.append('Excel 行的投递状态是「%s」：只有待投递的岗位能填写' % rows[0].get('投递状态'))
    return errors


# ---------------------------------------------------------------- progress
def pending(plan):
    fields = plan.get('字段') if isinstance(plan, dict) else None
    return [f for f in fields if isinstance(f, dict) and f.get('状态', '待填') not in DONE] if isinstance(fields, list) else []


def mark(plan, seq, state, readback=None, vault=None):
    """Record one field's progress. Any change voids the page-level check."""
    for f in plan['字段']:
        if f.get('序号') == seq:
            if state not in STATES:
                raise ValueError('状态须为 ' + '/'.join(STATES))
            m = SOURCE.match(f.get('值来源') or '')
            if f.get('状态') == '需用户' and state in ('待填', '已填', '已读回') and m and m.group(1) == '档案':
                key = m.group(2).strip()
                if vault is None or key not in vault:
                    raise ValueError('「' + str(f.get('标签')) + '」等用户答复：档案里还没有「' + key +
                                     '」，先用 profile_vault.py add 写进档案（并传 --vault）再改状态')
            f['状态'] = state
            if readback is not None:
                f['读回'] = ('一致' if state == '已读回' else '不一致') if (sensitive(f) or never_store(f)) else readback
            f['更新时间'] = now()
            plan.pop('页面校验', None)
            return f
    raise KeyError('没有序号 %s' % seq)


def vault_sync(plan, vault):
    """After the user answered: 需用户 fields whose 档案 value now exists go back to 待填."""
    moved, missing = [], []
    for f in plan.get('字段', []):
        m = SOURCE.match(f.get('值来源') or '')
        if f.get('状态') != '需用户' or not m or m.group(1) != '档案':
            continue
        key = m.group(2).strip()
        if key in vault:
            f['状态'] = '待填'
            f['备注'] = '档案已补「' + key + '」，待填写'
            f['更新时间'] = now()
            moved.append(f['标签'])
        else:
            missing.append({'字段': f['标签'], '档案字段': key})
    if moved:
        plan.pop('页面校验', None)
    return moved, missing


def page_check(plan, ok, observation, root=None):
    """Page-level validation looked at now (screenshot / readback file): all fields done, no visible errors."""
    path = Path(observation)
    if not path.is_absolute() and root:
        path = Path(root) / path
    if not path.is_file():
        raise ValueError('页面校验需要这次实际观察的截图或读回文件：' + str(observation))
    if ok and pending(plan):
        raise ValueError('还有 %d 个字段未读回，页面校验不能记为通过' % len(pending(plan)))
    plan['页面校验'] = {'结果': '通过' if ok else '不通过', '时间': now(), '观察': str(observation).replace('\\', '/')}
    return plan['页面校验']


def actions(plan, vault=None, root=None):
    """Ordered work list for the in-app browser / Chrome lanes.

    Consecutive 批量 fields form one group to send in a single batch call of the tool's own form
    interface (form_input / fill); 点击 and 上传 fields are single steps; fields the Agent cannot fill
    (user-only, privacy-info-fill off, value missing from the profile) are handed to the user.
    """
    groups, current = [], None
    privacy = privacy_enabled(root, plan.get('批次'))
    for f in pending(plan):
        method, reason = f.get('填法'), blocked_reason(f, vault, root, plan.get('批次'), privacy)
        if reason:
            current = None
            groups.append({'类型': '交接用户', '序号': f['序号'], '标签': f['标签'], '原因': reason})
            continue
        value = resolve(f, vault, root, plan.get('批次'), privacy)
        if method == '批量':
            item = {'序号': f['序号'], '标签': f['标签'], '定位': f['定位'], '控件': f['控件'], '值': value}
            if current is None:
                current = {'类型': '批量', '字段': []}
                groups.append(current)
            current['字段'].append(item)
            continue
        current = None
        if method == '点击':
            groups.append({'类型': '点击', '序号': f['序号'], '标签': f['标签'], '点击步骤': f.get('点击步骤'),
                           '读回定位': f.get('读回定位'), '期望': value})
        else:
            groups.append({'类型': '上传', '序号': f['序号'], '标签': f['标签'], '定位': f['定位'], '文件': value})
    return groups


def export_readback(plan_path, out=None):
    """填写读回.md: only from a complete plan whose read-backs and page check are from the last 15 minutes."""
    from evidence_layout import parse_time
    plan_path = Path(plan_path)
    plan = load(plan_path)
    errors = validate(plan)
    if errors:
        raise ValueError('填写方案不合法：' + errors[0])
    left = pending(plan)
    if left:
        raise ValueError('还有 %d 个字段未读回（%s）' % (len(left), '、'.join(f['标签'] for f in left[:5])))
    check = plan.get('页面校验') or {}
    limit = datetime.timedelta(minutes=FRESH_MINUTES)
    moment = datetime.datetime.now().astimezone()
    if check.get('结果') != '通过':
        raise ValueError('没有通过的页面校验：看过页面整体无报错后运行 fill_plan.py page-check --ok yes --observation <截图>')
    stamps = [('页面校验', check.get('时间'))] + [(f['标签'], f.get('更新时间')) for f in plan['字段'] if f.get('状态') == '已读回']
    for label, raw in stamps:
        t = parse_time(raw)
        if t is None or moment - t > limit or t - moment > datetime.timedelta(minutes=5):
            raise ValueError('「%s」的读回时间缺失或超过 %d 分钟：先在页面复核再导出' % (label, FRESH_MINUTES))
    out = Path(out) if out else plan_path.parent / '填写读回.md'
    lines = ['# 填写读回', '', '方案: ' + PLAN_NAME, '方案哈希: ' + plan_hash(plan_path), '通道: ' + str(plan.get('通道')),
             '页面校验: ' + check['结果'] + '（' + str(check.get('时间')) + '，观察 ' + str(check.get('观察')) + '）',
             '导出时间: ' + now(), '', '| 序号 | 字段 | 状态 | 读回 |', '|---|---|---|---|']
    for f in plan['字段']:
        shown = f.get('读回', '')
        if sensitive(f) or never_store(f):
            shown = shown if shown in ('一致', '不一致') else ''
        lines.append('| %s | %s | %s | %s |' % (f['序号'], f['标签'], f.get('状态', '待填'), str(shown).replace('|', '/').replace('\n', ' ')))
    lines += ['', '完成: %d/%d' % (len(plan['字段']), len(plan['字段']))]
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return out


def gate_errors(plan_path, readback_files, batch_id, row, lane, need_complete):
    """Checks a stage gate runs on a role's fill cache (see batch_check.Batch)."""
    where = Path(plan_path).name
    try:
        plan = load(plan_path)
    except (OSError, ValueError) as exc:
        return [where + ' 无法解析：' + type(exc).__name__]
    errors = [where + '：' + e for e in validate(plan)]
    if not isinstance(plan, dict):
        return errors
    if plan.get('批次') != batch_id:
        errors.append(where + ' 的批次不是本批')
    if plan.get('公司') != row.get('公司'):
        errors.append(where + ' 的公司与岗位表不一致')
    if canonical_url(str(plan.get('岗位链接') or '')) != canonical_url(str(row.get('岗位链接') or '')):
        errors.append(where + ' 的岗位链接与岗位表不一致')
    if lane and plan.get('通道') != lane:
        errors.append(where + ' 的通道与 公司/通道.md 不一致（换通道要先交接）')
    if need_complete and isinstance(plan.get('字段'), list):
        left = [f for f in plan['字段'] if isinstance(f, dict) and f.get('状态') not in DONE]
        if left:
            errors.append(where + ' 还有 %d 个字段未读回（%s）' % (len(left), '、'.join(str(f.get('标签')) for f in left[:5])))
        digest = plan_hash(plan_path)
        if not any(digest in Path(p).read_text(encoding='utf-8', errors='replace') for p in readback_files if Path(p).suffix == '.md'):
            errors.append('填写读回.md 不是由当前 ' + PLAN_NAME + ' 导出的（方案哈希不符）：用 fill_plan.py export 重新导出')
    return errors


# ---------------------------------------------------------------- CLI
def run(args, parser):
    if args.cmd == 'check':
        data = load(args.plan)
        errors = validate_template(data) if args.template else validate(data, ready=args.ready)
        if args.workbook and not args.template and isinstance(data, dict):
            errors += bind(data, args.workbook)
        return {'通过': not errors, '错误': errors}
    if args.cmd in ('skeleton', 'from-template'):
        if args.lane not in LANES:
            parser.error('--lane 须为 ' + '/'.join(LANES))
        source = load(args.source)
        if args.cmd == 'from-template':
            errors = validate_template(source)
            if errors:
                return {'通过': False, '错误': errors}
            plan = from_template(source, args.batch, args.company, args.url, args.lane)
        else:
            plan = from_inventory(source, args.batch, args.company, args.url, args.lane)
        errors = bind(plan, args.workbook) if args.workbook else []
        if errors:
            return {'通过': False, '错误': errors}
        save(args.out, plan)
        return {'通过': True, '文件': args.out, '字段数': len(plan['字段']), '错误': validate(plan)}
    if args.cmd == 'template':
        template = to_template(load(args.plan), args.site)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(template, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return {'通过': not validate_template(template), '文件': args.out, '错误': validate_template(template)}
    if args.cmd == 'pending':
        left = pending(load(args.plan))
        return {'未完成': len(left), '字段': [{'序号': f['序号'], '标签': f['标签'], '状态': f.get('状态', '待填'), '填法': f.get('填法')} for f in left]}
    if args.cmd == 'actions':
        return {'动作': actions(load(args.plan), vault_values(args.vault), args.root)}
    if args.cmd == 'mark':
        plan = load(args.plan)
        field = mark(plan, args.field, args.status, args.readback, vault_values(args.vault) if args.vault else None)
        save(args.plan, plan)
        return {'通过': True, '字段': field['标签'], '状态': field['状态']}
    if args.cmd == 'vault-sync':
        plan = load(args.plan)
        moved, missing = vault_sync(plan, vault_values(args.vault))
        save(args.plan, plan)
        return {'通过': not missing, '已改回待填': moved, '档案仍缺': missing,
                '下一步': '把档案仍缺的字段按公司合并成一次提问，答复用 profile_vault.py add 写进档案后再运行本命令' if missing else '继续填写'}
    if args.cmd == 'page-check':
        plan = load(args.plan)
        check = page_check(plan, args.ok == 'yes', args.observation, args.root)
        save(args.plan, plan)
        return {'通过': check['结果'] == '通过', '页面校验': check}
    path = export_readback(args.plan, args.out)
    return {'通过': True, '文件': str(path), '方案哈希': plan_hash(args.plan)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('check'); p.add_argument('plan'); p.add_argument('--ready', action='store_true'); p.add_argument('--template', action='store_true')
    p.add_argument('--workbook')
    for name in ('skeleton', 'from-template'):
        p = sub.add_parser(name); p.add_argument('source'); p.add_argument('--workbook')
        for opt in ('--batch', '--company', '--url', '--lane', '--out'):
            p.add_argument(opt, required=True)
    p = sub.add_parser('template'); p.add_argument('plan'); p.add_argument('--out', required=True); p.add_argument('--site')
    p = sub.add_parser('pending'); p.add_argument('plan')
    p = sub.add_parser('actions'); p.add_argument('plan'); p.add_argument('--vault'); p.add_argument('--root')
    p = sub.add_parser('mark'); p.add_argument('plan'); p.add_argument('--field', type=int, required=True)
    p.add_argument('--status', required=True); p.add_argument('--readback'); p.add_argument('--vault')
    p = sub.add_parser('vault-sync'); p.add_argument('plan'); p.add_argument('--vault', required=True)
    p = sub.add_parser('page-check'); p.add_argument('plan'); p.add_argument('--ok', choices=['yes', 'no'], required=True)
    p.add_argument('--observation', required=True); p.add_argument('--root')
    p = sub.add_parser('export'); p.add_argument('plan'); p.add_argument('--out')
    args = parser.parse_args(argv)
    out = {}
    try:
        out = run(args, parser)
    except (ValueError, KeyError) as exc:
        out = {'通过': False, '错误': [str(exc).strip("'")]}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get('通过', True) else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
