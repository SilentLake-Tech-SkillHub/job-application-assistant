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
  fill_plan.py mark     <方案.json> --field N --status 已读回 [--readback TEXT]
  fill_plan.py export   <方案.json> [--out 填写读回.md]          readback evidence bound to the plan hash

Sensitive fields (phone, e-mail, address, contacts…) keep a 值来源 reference (档案:<字段>) instead of
the literal value, and their 读回 is only 一致 / 不一致. Passwords, verification codes and ID/bank
numbers are never in the plan: those fields are 填法 用户.
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
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from submit_words import submit_like_text  # noqa: E402
from workbook_state import canonical_url  # noqa: E402

PLAN_NAME = '填写方案.json'
VERSION = 1
TOP_KEYS = {'方案版本', '批次', '公司', '岗位链接', '表单链接', '通道', '站点模板', '生成时间', '更新时间', '字段', '保存步骤', '备注'}
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
SENSITIVE = re.compile(r'(手机|电话|联系方式|邮箱|e-?mail|住址|地址|家庭|紧急联系人|微信|qq|出生|生日|民族|政治面貌|婚|健康|宗教)', re.I)
NEVER = re.compile(r'(密码|口令|验证码|校验码|动态码|身份证|证件号|护照|银行卡|卡号|cookie|token|password|otp|captcha)', re.I)
SOURCE = re.compile(r'^(档案|材料):\s*(.+)$')


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
        locator = {'label': label} if label and c.get('labelSource') in ('label', 'aria-labelledby', 'aria-label') else {'css': c.get('locator') or 'body'}
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


def resolve(field, vault=None, root=None, batch=None):
    """The value to put in a field, or None when only the user can provide it."""
    if field.get('填法') == '用户' or field.get('值来源') == '用户':
        return None
    if field.get('值') not in (None, ''):
        return field['值']
    m = SOURCE.match(field.get('值来源') or '')
    if not m:
        return None
    kind, key = m.group(1), m.group(2).strip()
    if kind == '档案':
        return (vault or {}).get(key)
    if root and batch:
        rel = materials(root, batch).get(key)
        return str((Path(root) / rel.replace('\\', '/')).resolve()) if rel else None
    return None


# ---------------------------------------------------------------- progress
def pending(plan):
    return [f for f in plan.get('字段', []) if f.get('状态', '待填') not in DONE]


def mark(plan, seq, state, readback=None):
    for f in plan['字段']:
        if f.get('序号') == seq:
            if state not in STATES:
                raise ValueError('状态须为 ' + '/'.join(STATES))
            f['状态'] = state
            if readback is not None:
                f['读回'] = ('一致' if state == '已读回' else '不一致') if (sensitive(f) or never_store(f)) else readback
            f['更新时间'] = now()
            return f
    raise KeyError('没有序号 %s' % seq)


def actions(plan, vault=None, root=None):
    """Ordered work list for the in-app browser / Chrome lanes.

    Consecutive 批量 fields form one group to send in a single batch call of the tool's own form
    interface (form_input / fill); 点击 and 上传 fields are single steps; 用户 fields are handoffs.
    """
    groups, current = [], None
    for f in pending(plan):
        method = f.get('填法')
        if method == '批量':
            value = resolve(f, vault, root, plan.get('批次'))
            item = {'序号': f['序号'], '标签': f['标签'], '定位': f['定位'], '控件': f['控件'],
                    '值': value if value is not None else '（缺值：先补档案或问用户）'}
            if current is None:
                current = {'类型': '批量', '字段': []}
                groups.append(current)
            current['字段'].append(item)
            continue
        current = None
        if method == '点击':
            groups.append({'类型': '点击', '序号': f['序号'], '标签': f['标签'], '点击步骤': f.get('点击步骤'),
                           '读回定位': f.get('读回定位'), '期望': resolve(f, vault, root, plan.get('批次'))})
        elif method == '上传':
            groups.append({'类型': '上传', '序号': f['序号'], '标签': f['标签'], '定位': f['定位'],
                           '文件': resolve(f, vault, root, plan.get('批次'))})
        else:
            groups.append({'类型': '交接用户', '序号': f['序号'], '标签': f['标签']})
    return groups


def export_readback(plan_path, out=None):
    plan_path = Path(plan_path)
    plan = load(plan_path)
    out = Path(out) if out else plan_path.parent / '填写读回.md'
    lines = ['# 填写读回', '', '方案: ' + PLAN_NAME, '方案哈希: ' + plan_hash(plan_path), '通道: ' + str(plan.get('通道')),
             '导出时间: ' + now(), '', '| 序号 | 字段 | 状态 | 读回 |', '|---|---|---|---|']
    for f in plan['字段']:
        shown = f.get('读回', '')
        if sensitive(f) or never_store(f):
            shown = shown if shown in ('一致', '不一致') else ''
        lines.append('| %s | %s | %s | %s |' % (f['序号'], f['标签'], f.get('状态', '待填'), str(shown).replace('|', '/').replace('\n', ' ')))
    done = sum(1 for f in plan['字段'] if f.get('状态') in DONE)
    lines += ['', '完成: %d/%d' % (done, len(plan['字段']))]
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
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('check'); p.add_argument('plan'); p.add_argument('--ready', action='store_true'); p.add_argument('--template', action='store_true')
    for name in ('skeleton', 'from-template'):
        p = sub.add_parser(name); p.add_argument('source')
        for opt in ('--batch', '--company', '--url', '--lane', '--out'):
            p.add_argument(opt, required=True)
    p = sub.add_parser('template'); p.add_argument('plan'); p.add_argument('--out', required=True); p.add_argument('--site')
    p = sub.add_parser('pending'); p.add_argument('plan')
    p = sub.add_parser('actions'); p.add_argument('plan'); p.add_argument('--vault'); p.add_argument('--root')
    p = sub.add_parser('mark'); p.add_argument('plan'); p.add_argument('--field', type=int, required=True)
    p.add_argument('--status', required=True); p.add_argument('--readback')
    p = sub.add_parser('export'); p.add_argument('plan'); p.add_argument('--out')
    args = parser.parse_args(argv)
    out = {}
    if args.cmd == 'check':
        data = load(args.plan)
        errors = validate_template(data) if args.template else validate(data, ready=args.ready)
        out = {'通过': not errors, '错误': errors}
    elif args.cmd in ('skeleton', 'from-template'):
        if args.lane not in LANES:
            parser.error('--lane 须为 ' + '/'.join(LANES))
        source = load(args.source)
        if args.cmd == 'from-template':
            errors = validate_template(source)
            if errors:
                print(json.dumps({'通过': False, '错误': errors}, ensure_ascii=False, indent=2))
                return 1
            plan = from_template(source, args.batch, args.company, args.url, args.lane)
        else:
            plan = from_inventory(source, args.batch, args.company, args.url, args.lane)
        save(args.out, plan)
        out = {'通过': True, '文件': args.out, '字段数': len(plan['字段']), '错误': validate(plan)}
    elif args.cmd == 'template':
        template = to_template(load(args.plan), args.site)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(template, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        out = {'通过': not validate_template(template), '文件': args.out, '错误': validate_template(template)}
    elif args.cmd == 'pending':
        left = pending(load(args.plan))
        out = {'未完成': len(left), '字段': [{'序号': f['序号'], '标签': f['标签'], '状态': f.get('状态', '待填'), '填法': f.get('填法')} for f in left]}
    elif args.cmd == 'actions':
        out = {'动作': actions(load(args.plan), vault_values(args.vault), args.root)}
    elif args.cmd == 'mark':
        plan = load(args.plan)
        field = mark(plan, args.field, args.status, args.readback)
        save(args.plan, plan)
        out = {'通过': True, '字段': field['标签'], '状态': field['状态']}
    elif args.cmd == 'export':
        path = export_readback(args.plan, args.out)
        out = {'通过': True, '文件': str(path), '方案哈希': plan_hash(args.plan)}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get('通过', True) else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
