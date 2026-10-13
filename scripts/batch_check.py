#!/usr/bin/env python3
"""Batch check: the Excel tracker plus 投递证据/ are the whole record (no JSON ledger).

  batch_check.py --workbook <追踪表.xlsx> --batch <批次>            # consistency + report
  batch_check.py --workbook <追踪表.xlsx> --batch <批次> --closeout # may the batch end?
  batch_check.py --workbook <追踪表.xlsx> --batch <批次> --where --company <公司> [--url <岗位链接>]

The application root is the nearest folder above the workbook that contains 投递证据/ (or --root).
Labels follow campus-job-skills workbook-schema.md: 校招计划.盘点状态 (five values) and the role
sheets' 投递状态 (待投递 / 已提交), with explanations in 备注. Structural checks only: a pass does not
prove a website saved, accepted or received anything.
"""
import argparse
import datetime
import json
import re
import sys
from collections import Counter
from pathlib import Path

from workbook_state import Workbook, INVENTORY_STATUSES, SCANNED_NO_ROLE, NOT_STARTED, canonical_url
from evidence_layout import (EVIDENCE_DIR, batch_dir, company_dir, role_dir, find, parse, value, list_items,
                             ref_exists, file_hash, safe_name, parse_time)
import fill_plan
import submit_pass

QUERY_SECTIONS = ('入口', '硬范围', '偏好轴', '默认岗位次序', '公司清单', '目标与停止条件', '材料', '授权',
                  '执行方式', '自动化授权', '能力预检')
SUBSKILLS = ('login-phone-otp', 'login-wechat', 'captcha-solve', 'privacy-info-fill', 'terms-consent')
UNBLOCK_OWNERS = ('用户', '站点', '平台', '官方规则')
YES, NO = ('是', '同意', 'yes', 'true'), ('否', '不同意', 'no', 'false')
WORDS = {
    '计数口径': {'eligible': 'eligible', '有合格岗位的公司': 'eligible', 'checked': 'checked', '已查公司': 'checked'},
    '补位规则': {'keep_gap': 'keep_gap', '留空': 'keep_gap', 'replace': 'replace', '补位': 'replace'},
    '实习政策': {'excluded': 'excluded', '不收实习': 'excluded', 'separate': 'separate', '单独批次': 'separate',
             'conversion_last': 'conversion_last', '转正实习排最后': 'conversion_last'},
    '执行方式': {'single': 'single', '一个AI': 'single', '一个 AI': 'single', 'parallel': 'parallel', '多个AI': 'parallel', '多个 AI': 'parallel'},
    '模式': {'off': 'off', '不开启': 'off', 'semi': 'semi', '半自动': 'semi', 'full': 'full', '全自动': 'full'},
    '条款方式': {'per_item': 'per_item', '逐项查看': 'per_item', 'current_workflow_all': 'all', '全部代勾': 'all'},
    '验证码': {'user_result': 'user', '用户提供': 'user', 'agent_takeover': 'agent', '完整接手': 'agent'},
    '通道': {'in_app': 'in_app', '内置浏览器': 'in_app', 'chrome': 'chrome', 'Chrome': 'chrome', 'playwright': 'playwright', 'Playwright': 'playwright'},
    '结论': {'符合': 'meets', '待核': 'pending', '不符合': 'not_meets'},
    '状态': {'已核实': 'verified', '未核实': 'unverified'},
    '决定': {'不变': 'unchanged', '变更': 'changed'},
}
CHANNEL_KEYS = ('内置浏览器', 'Chrome', 'computer use', '系统脚本', 'Playwright')
CHANNEL_STATES = ('可用', '不可用', '不适用', '未检查')
TARGET_FIELDS = ('公司', 'BU', '办公地', '岗位', '意向')
RECHECK_HOURS = 24      # 提交前复核 older than this is stale (e.g. resumed after a break)
COUNT_RULE_DAYS = 7     # a verified 数量规则 older than this is re-verified before submitting
LANE_NAME = {'in_app': '内置浏览器', 'chrome': 'Chrome', 'playwright': 'Playwright'}




def word(key, raw):
    return WORDS[key].get((raw or '').strip())


def find_root(start):
    here = Path(start).resolve()
    here = here.parent if here.is_file() or here.suffix else here
    for candidate in [here, *here.parents]:
        if (candidate / EVIDENCE_DIR).is_dir():
            return candidate
    return None


def yes(raw):
    return (raw or '').strip().lower() in YES


class Batch:
    def __init__(self, workbook, batch_id, root=None):
        self.batch_id = batch_id
        self.root = Path(root) if root else find_root(workbook)
        self.errors = []
        self.book = Workbook(workbook)
        if self.root is None:
            self.errors.append('找不到投递根目录：工作簿上方没有 ' + EVIDENCE_DIR + '/ 文件夹（或用 --root 指定）')
            self.root = Path(workbook).resolve().parent
        self.dir = batch_dir(self.root, batch_id)
        self.query_path = self.dir / '批次' / 'Query.md'
        self.query, self.query_lines = parse(self.query_path)
        self.scope = self._scope()

    # ------------------------------------------------------------ paths
    def company_dir(self, company):
        return company_dir(self.root, self.batch_id, company)

    def role_dir(self, company, url):
        return role_dir(self.root, self.batch_id, company, url)

    def rel(self, path):
        try:
            return Path(path).resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(path)

    def _scope(self):
        companies = {}
        for item in list_items(self.query_lines.get('公司清单', [])):
            if item and item[0]:
                companies[item[0]] = item[1] if len(item) > 1 and item[1] else '全部'
        return companies

    # ------------------------------------------------------------ Query
    def query_errors(self):
        errors = []
        q = self.query
        where = self.rel(self.query_path)
        if not self.query_path.is_file():
            return [where + ' 不存在：Query 的开始前必问项必须先写成这个文件（阶段契约 §3）']
        if value(q, '批次', '') != self.batch_id:
            errors.append(where + ' 顶部需要「批次: ' + self.batch_id + '」')
        for section in QUERY_SECTIONS:
            if section not in q:
                errors.append(where + ' 缺少「## ' + section + '」节')
                continue
            basis = value(q, '依据', section)
            if not ref_exists(self.root, basis):
                errors.append(where + ' 「' + section + '」节的「依据:」必须指向 ' + EVIDENCE_DIR + '/ 里存在的确认记录文件，现为「' + basis + '」')
        if '入口' in q and value(q, '类型', '入口') != '投递':
            errors.append('入口类型必须是「投递」：只研究/收集岗位的请求走研究流程（阶段契约 §1）')
        if '偏好轴' in q:
            if not word('实习政策', value(q, '实习政策', '偏好轴')):
                errors.append('偏好轴节需要「实习政策: 不收实习 / 单独批次 / 转正实习排最后」')
            if value(q, '冲突策略', '偏好轴') != '用户决定':
                errors.append('偏好轴节需要「冲突策略: 用户决定」（跨轴冲突不自动取舍）')
        if '公司清单' in q and not self.scope:
            errors.append('公司清单为空：用「- 公司 | 桶」逐行列出本批确认的公司')
        if '目标与停止条件' in q:
            s = '目标与停止条件'
            if not word('计数口径', value(q, '计数口径', s)):
                errors.append('目标节需要「计数口径: 有合格岗位的公司 / 已查公司」')
            if not word('补位规则', value(q, '补位规则', s)):
                errors.append('目标节需要「补位规则: 留空 / 补位」')
            targets, bad = self.targets()
            if bad or not targets:
                errors.append('目标节需要「目标: 桶=数字或无, …」，与公司清单的桶一致')
            elif set(targets) != set(self.scope.values()):
                errors.append('目标里的桶 ' + '、'.join(sorted(targets)) + ' 与公司清单的桶 ' + '、'.join(sorted(set(self.scope.values()))) + ' 不一致')
            if any(v is None for v in targets.values()) and not value(q, '停止条件', s):
                errors.append('有桶不设数字目标时，目标节需要「停止条件:」')
        if '材料' in q:
            materials = list_items(self.query_lines.get('材料', []))
            if not materials:
                errors.append('材料节需要「- 名称 | 相对路径 | sha256」')
            for item in materials:
                if len(item) < 3:
                    errors.append('材料「' + item[0] + '」需要 相对路径 和 sha256')
                    continue
                path = (self.root / item[1].replace('\\', '/')).resolve()
                if not path.is_file() or self.root.resolve() not in path.parents:
                    errors.append('材料文件不存在：' + item[1])
                elif file_hash(path) != item[2].lower():
                    errors.append('材料「' + item[0] + '」的 sha256 与文件不一致：文件已变，需要重新确认材料')
        if '授权' in q:
            for key in ('选岗授权', '准备授权'):
                if not (yes(value(q, key, '授权')) or value(q, key, '授权').strip().lower() in NO):
                    errors.append('授权节需要「' + key + ': 是/否」')
        if '执行方式' in q and not word('执行方式', value(q, '执行方式', '执行方式')):
            errors.append('执行方式节需要「执行方式: 一个AI / 多个AI」')
        if '自动化授权' in q:
            errors.extend(self.automation_errors())
        if '能力预检' in q:
            for key in CHANNEL_KEYS:
                if value(q, key, '能力预检') not in CHANNEL_STATES:
                    errors.append('能力预检节需要「' + key + ': 可用/不可用/不适用/未检查」')
            if value(q, 'Chrome', '能力预检') == '不可用' and value(q, 'Playwright', '能力预检') == '未检查':
                errors.append('Chrome 插件不可用：必须检查常备的 Playwright 备用通道（不需要另行同意），写 可用/不可用')
        return errors

    def automation_errors(self):
        q, s, errors = self.query, '自动化授权', []
        mode = word('模式', value(q, '模式', s))
        raw = value(q, '已开启', s)
        enabled = [x.strip() for x in re.split(r'[,，、\s]+', raw) if x.strip() and x.strip() != '无']
        if not mode:
            errors.append('自动化授权节需要「模式: 不开启 / 半自动 / 全自动」')
        if any(x not in SUBSKILLS for x in enabled):
            errors.append('「已开启」只能列五个自动化子 Skill 的名字')
        if mode == 'off' and enabled:
            errors.append('模式为不开启时「已开启」应为 无')
        if mode == 'full' and set(enabled) != set(SUBSKILLS):
            errors.append('全自动必须开启全部五个子 Skill')
        if mode == 'semi' and not enabled:
            errors.append('半自动需要列出开启了哪几个子 Skill')
        terms = word('条款方式', value(q, '条款方式', s))
        if not terms:
            errors.append('自动化授权节需要「条款方式: 逐项查看 / 全部代勾」（在 Query 里问定）')
        if terms == 'all' and self.three('条款代勾') < 3:
            errors.append('条款方式为全部代勾：需要 确认记录/条款代勾-1.md、-2.md、-3.md 三次确认')
        if word('验证码', value(q, '验证码', s)) == 'agent' and self.three('验证码接手') < 3:
            errors.append('验证码完整接手：需要 确认记录/验证码接手-1.md … -3.md 三次确认')
        return errors

    def three(self, prefix):
        folder = self.dir / '确认记录'
        return len([p for p in folder.glob(prefix + '-*') if p.is_file()]) if folder.is_dir() else 0

    def targets(self):
        raw = value(self.query, '目标', '目标与停止条件')
        result, bad = {}, False
        for part in re.split(r'[,，;；]', raw):
            if not part.strip():
                continue
            m = re.match(r'^\s*(.+?)\s*[=＝]\s*(\d+|无)\s*$', part)
            if not m:
                bad = True
                continue
            result[m.group(1)] = None if m.group(2) == '无' else int(m.group(2))
        return result, bad

    # ------------------------------------------------------------ companies and roles
    def started_roles(self):
        """Role folders of this batch (any evidence written) mapped to their Excel rows."""
        roles = []
        base = self.dir / '岗位'
        folders = {p.name: p for p in base.iterdir() if p.is_dir()} if base.is_dir() else {}
        for row in self.book.roles:
            folder = self.role_dir(row['公司'], row['岗位链接'])
            if folder.name in folders:
                roles.append((row, folder))
                folders.pop(folder.name)
        orphans = list(folders.values())
        return roles, orphans

    def blocked(self, folder):
        path = Path(folder) / '受阻.md'
        if not path.is_file():
            return None, []
        kv, _ = parse(path)
        errors = []
        for key in ('原因', '解除方', '下一步'):
            if not value(kv, key):
                errors.append(self.rel(path) + ' 需要「' + key + ':」')
        owner = value(kv, '解除方')
        if owner and owner not in UNBLOCK_OWNERS:
            errors.append(self.rel(path) + ' 的解除方必须是 用户/站点/平台/官方规则：Agent 能做的事是待办，不是受阻')
        return (not errors), errors

    def count_rule(self, company):
        path = self.company_dir(company) / '数量规则.md'
        kv, _ = parse(path)
        state = word('状态', value(kv, '状态'))
        raw = value(kv, '上限')
        limit = int(raw) if raw.isdigit() else None
        return path, kv, state, limit

    def company_errors(self, company):
        errors = []
        folder = self.company_dir(company)
        path, kv, state, limit = self.count_rule(company)
        if not path.is_file():
            errors.append(self.rel(path) + ' 不存在：选岗或填表前先查清投递数量规则（父 Skill 数量规则门禁）')
        else:
            if not state:
                errors.append(self.rel(path) + ' 需要「状态: 已核实 / 未核实」')
            if state == 'verified':
                if limit is None:
                    errors.append(self.rel(path) + ' 已核实时需要「上限: 数字」')
                for key in ('来源', '核验日期'):
                    if not value(kv, key):
                        errors.append(self.rel(path) + ' 已核实时需要「' + key + ':」')
        order = folder / '次序确认.md'
        if not order.is_file():
            errors.append(self.rel(order) + ' 不存在：开始这家公司的申请动作前，用逐岗包确认次序（可多家合并一次确认）')
        else:
            kv, _ = parse(order)
            if not word('决定', value(kv, '决定')):
                errors.append(self.rel(order) + ' 需要「决定: 不变 / 变更」')
            if not ref_exists(self.root, value(kv, '依据')):
                errors.append(self.rel(order) + ' 的「依据:」必须指向用户确认记录文件')
        lane_file = folder / '通道.md'
        lane_kv = parse(lane_file)[0]
        lane = word('通道', value(lane_kv, '通道'))
        if not lane:
            errors.append(self.rel(lane_file) + ' 需要「通道: 内置浏览器 / Chrome / Playwright」')
        elif lane in ('in_app', 'chrome') and value(self.query, LANE_NAME[lane], '能力预检') != '可用':
            errors.append(company + ' 分到「' + LANE_NAME[lane] + '」通道，但 Query 能力预检里它不是「可用」：按实际可用能力分配')
        elif lane == 'playwright':
            if value(self.query, 'Playwright', '能力预检') != '可用':
                errors.append(company + ' 走 Playwright 通道，但 Query 能力预检里 Playwright 不是「可用」（缺依赖时告诉用户怎么装，由用户调整环境）')
            if value(self.query, 'Chrome', '能力预检') == '可用' and not value(lane_kv, '原因'):
                errors.append(self.rel(lane_file) + '：Chrome 插件可用时 Playwright 只作备用，改用它需写「原因:」（如插件断开、重连失败）')
        return errors

    def lane(self, company):
        return LANE_NAME.get(word('通道', value(parse(self.company_dir(company) / '通道.md')[0], '通道')))

    def role_files(self, folder):
        f = lambda stem: find(folder, stem)  # noqa: E731
        return {k: f(k) for k in ('岗位包', '资格核对', '尝试指令', '用户选岗', '填写方案', '填写读回', '草稿读回', '无草稿说明',
                                  '审核包', '批准', '提交前复核', '目标确认', '回执', '结果不确定', '提交已点击', '追踪表读回')}

    def clicked_without_result(self, files_or_folder):
        folder = files_or_folder if isinstance(files_or_folder, Path) else (
            files_or_folder['提交已点击'][0].parent if files_or_folder['提交已点击'] else None)
        return bool(folder) and submit_pass.unresolved_attempt(self.root, folder)

    def other_batch_results(self, folder, row):
        """A receipt or uncertain result for the same link in ANY batch blocks a new application."""
        errors = []
        base = self.root / EVIDENCE_DIR
        for other in base.glob('*/岗位/' + folder.name) if base.is_dir() else []:
            if other.resolve() == Path(folder).resolve():
                continue
            done = submit_pass.role_done(other)
            if done == 'receipt recorded' and row.get('投递状态') != '已提交':
                errors.append(self.rel(other) + ' 已有回执，但 Excel 这一行仍是「%s」：先入账为已提交，不能重投' % row.get('投递状态'))
            elif done == 'result uncertain':
                errors.append(self.rel(other) + ' 记录了结果不确定：先在申请中心核实，不能重投')
        return errors

    def attempt_errors(self, url=None):
        """Unreconciled submit clicks in ANY batch (a new batch cannot bypass an old marker)."""
        errors = []
        target = canonical_url(url) if url else None
        for folder, marker_url, unresolved in submit_pass.attempts(self.root):
            if not marker_url:
                errors.append(self.rel(folder) + '/提交已点击.md 里的岗位链接损坏：先查申请中心核实这次点击，不能忽略')
                continue
            if unresolved and (target is None or marker_url == target):
                reasons = submit_pass.check_errors(self.root, folder)
                errors.append(self.rel(folder) + ' 已点击提交但结果未核实：先查申请中心——查到就存回执入账，查不清写 结果不确定.md，'
                              '确认未提交写 提交核查.md 后才能重试（' + reasons[0] + '）')
        return errors

    def role_gate(self, url, stage):
        """Errors that block moving this role to stage ∈ prepare/review/submit."""
        rows = self.book.role_by_url(url)
        if len(rows) != 1:
            return ['岗位表里找不到唯一的这条岗位链接（找到 %d 行）：%s' % (len(rows), url)]
        row = rows[0]
        company = row['公司']
        folder = self.role_dir(company, url)
        files = self.role_files(folder)
        here = self.rel(folder)
        errors = []
        if company not in self.scope:
            errors.append(company + ' 不在本批 Query 的公司清单里')
        clicked = self.attempt_errors(url) + self.other_batch_results(folder, row)
        if clicked:
            return errors + clicked + ['不能再次进入 ' + stage + '：同一岗位链接有未核实的提交点击或其他批次的结果记录']
        if row.get('投递状态') == '已提交' or files['回执'] or files['结果不确定']:
            return errors + ['这个岗位已提交或结果不确定，不能再次进入 ' + stage + '（先查申请中心）']
        if row.get('投递状态') != '待投递':
            errors.append('岗位表里该行投递状态应为「待投递」')
        if self.book.company_status(company) != '已有相关岗位记录':
            errors.append(company + ' 在「校招计划」的盘点状态应为「已有相关岗位记录」，现为「%s」' % self.book.company_status(company))
        errors.extend(self.company_errors(company))
        if not files['岗位包']:
            errors.append(here + '/岗位包.md 不存在：表单动作前先交付逐岗包（公司/BU/办公地/岗位/直链/完整JD依据）')
        if not files['资格核对']:
            errors.append(here + '/资格核对.md 不存在')
        else:
            conclusion = word('结论', value(parse(files['资格核对'][0])[0], '结论'))
            if not conclusion:
                errors.append(here + '/资格核对.md 需要「结论: 符合 / 待核 / 不符合」')
            elif conclusion != 'meets' and not files['尝试指令']:
                errors.append('资格结论不是「符合」：需要用户对具体缺口的尝试指令 ' + here + '/尝试指令.md')
        if not yes(value(self.query, '选岗授权', '授权')) and not files['用户选岗']:
            errors.append('Query 未授权 Agent 选岗：需要 ' + here + '/用户选岗.md（用户点名这个岗位）')
        if not yes(value(self.query, '准备授权', '授权')):
            errors.append('Query 未授权准备表单（授权节「准备授权: 是」）')
        if stage in ('review', 'submit'):
            if not files['填写方案']:
                errors.append(here + '/' + fill_plan.PLAN_NAME + ' 不存在：填写缓存记录逐字段填法与读回，填完用 fill_plan.py export 导出填写读回')
            else:
                errors.extend(here + '/' + e for e in fill_plan.gate_errors(
                    files['填写方案'][0], files['填写读回'], self.batch_id, row, self.lane(company), need_complete=True))
            if not files['填写读回']:
                errors.append(here + '/填写读回.* 不存在：逐字段读回后才算填完')
            if not files['草稿读回'] and not files['无草稿说明']:
                errors.append(here + '/草稿读回.*（保存并重开后读回）或 无草稿说明.md（站点无草稿，页面保持打开）不存在')
            if not files['审核包']:
                errors.append(here + '/审核包.md 不存在')
        if stage == 'submit':
            errors.extend(self.submit_errors(row, folder, files))
        return errors

    def submit_errors(self, row, folder, files):
        errors, here = [], self.rel(folder)
        if not files['审核包']:
            return errors
        digest = file_hash(files['审核包'][0])
        for name in ('批准', '目标确认'):
            if not files[name]:
                errors.append(here + '/' + name + '.md 不存在')
            elif digest not in files[name][0].read_text(encoding='utf-8', errors='replace'):
                errors.append(here + '/' + name + '.md 引用的不是当前审核包（审核包哈希 ' + digest[:12] + '…）：审核后有修改，需要重新审核与确认')
        if files['目标确认']:
            kv, _ = parse(files['目标确认'][0])
            for key in TARGET_FIELDS:
                if not value(kv, key):
                    errors.append(here + '/目标确认.md 需要「' + key + ':」（多意向按投递顺序写，无则写 无）')
            if value(kv, '公司') and value(kv, '公司') != row['公司']:
                errors.append('目标确认的公司与岗位表不一致')
            if value(kv, '岗位') and value(kv, '岗位') != row.get('岗位名称'):
                errors.append('目标确认的岗位与岗位表不一致')
            if value(kv, 'BU') and value(kv, 'BU') != (row.get('所属BU') or '未披露'):
                errors.append('目标确认的 BU 与岗位表不一致')
            if value(kv, '办公地') and value(kv, '办公地') not in (row.get('工作地点') or ''):
                errors.append('目标确认的办公地不在岗位表工作地点里')
            if not ref_exists(self.root, value(kv, '依据')):
                errors.append(here + '/目标确认.md 的「依据:」必须指向用户对这一确切目标的确认记录')
        if not files['提交前复核']:
            errors.append(here + '/提交前复核.md 不存在（岗位、计划、名额、材料、表单版本）')
        else:
            checked = parse_time(value(parse(files['提交前复核'][0])[0], '复核时间'))
            now = datetime.datetime.now().astimezone()
            if checked is None:
                errors.append(here + '/提交前复核.md 需要「复核时间:」（ISO 时间）')
            elif now - checked > datetime.timedelta(hours=RECHECK_HOURS) or checked - now > datetime.timedelta(minutes=10):
                errors.append(here + '/提交前复核.md 超过 %d 小时（或时间不对）：中断后再提交，先重新确认岗位仍在线、名额与表单未变' % RECHECK_HOURS)
        company = row['公司']
        rule_path, rule_kv, state, limit = self.count_rule(company)
        if state == 'verified':
            verified = parse_time(value(rule_kv, '核验日期'))
            if verified is None or datetime.datetime.now().astimezone() - verified > datetime.timedelta(days=COUNT_RULE_DAYS):
                errors.append(self.rel(rule_path) + ' 的核验日期缺失或超过 %d 天：提交前重新核验数量规则' % COUNT_RULE_DAYS)
        submitted = [r for r in self.book.roles_of(company) if r.get('投递状态') == '已提交']
        if limit is not None and len(submitted) + 1 > limit:
            errors.append(company + ' 已提交 %d 个，再提交会超过官方上限 %d' % (len(submitted), limit))
        if state == 'unverified' and submitted and not (self.company_dir(company) / '首次提交后读回.md').is_file():
            errors.append(company + ' 数量规则未核实：第一个提交后先读回账号状态（公司/首次提交后读回.md），再确认下一个')
        return errors

    # ------------------------------------------------------------ whole-batch consistency
    def consistency_errors(self):
        errors = list(self.query_errors())
        errors.extend(self.book.label_errors(self.scope.keys()))
        roles, orphans = self.started_roles()
        for folder in orphans:
            errors.append(self.rel(folder) + ' 找不到对应的岗位表行：岗位行必须先写进 Excel')
        for company in self.scope:
            if company not in self.book.companies():
                errors.append(company + ' 在公司清单里，但工作簿里没有这家公司')
                continue
            touched = self.company_dir(company).is_dir() or any(r['公司'] == company for r, _ in roles)
            status = self.book.company_status(company)
            if touched and status in ('', NOT_STARTED):
                errors.append(company + ' 已经扫描过，但「校招计划」盘点状态仍是「%s」：扫过就必须写五个标签之一' % (status or '空'))
            ok, problems = self.blocked(self.company_dir(company))
            errors.extend(problems)
        limits = Counter()
        for row, folder in roles:
            files = self.role_files(folder)
            here = self.rel(folder)
            status = row.get('投递状态')
            if self.clicked_without_result(files):
                errors.append(here + ' 已点击提交但没有回执也没有 结果不确定.md：先查申请中心，存回执（并把投递状态改为已提交）、'
                              '写 结果不确定.md，或确认未提交后写 提交核查.md')
            if files['填写方案']:
                errors.extend(here + '/' + e for e in fill_plan.gate_errors(
                    files['填写方案'][0], files['填写读回'], self.batch_id, row, self.lane(row['公司']), need_complete=False))
            if files['回执'] and status != '已提交':
                errors.append(here + ' 有回执，但岗位表投递状态仍是「%s」：回执要入账为「已提交」' % status)
            if status == '已提交':
                if not files['回执']:
                    errors.append('%s第%d行 投递状态为「已提交」，但 %s 里没有回执' % (row['_sheet'], row['_row'], here))
                if not files['追踪表读回']:
                    errors.append(here + '/追踪表读回.md 不存在：写入「已提交」后要重开工作簿读回')
                limits[row['公司']] += 1
            _, problems = self.blocked(folder)
            errors.extend(problems)
        for company, count in limits.items():
            _, _, _, limit = self.count_rule(company)
            if limit is not None and count > limit:
                errors.append(company + ' 本批已提交 %d 个，超过官方上限 %d' % (count, limit))
        return errors

    # ------------------------------------------------------------ counts and closeout
    def report(self):
        targets, _ = self.targets()
        basis = word('计数口径', value(self.query, '计数口径', '目标与停止条件'))
        rule = word('补位规则', value(self.query, '补位规则', '目标与停止条件'))
        roles, _ = self.started_roles()
        statuses = {c: self.book.company_status(c) for c in self.scope}
        checked = Counter(self.scope[c] for c, s in statuses.items() if s and s != NOT_STARTED)
        eligible = Counter(self.scope[c] for c, s in statuses.items() if s == '已有相关岗位记录')
        gaps = Counter(self.scope[c] for c, s in statuses.items() if s in SCANNED_NO_ROLE)
        blocked_companies = [c for c in self.scope if self.blocked(self.company_dir(c))[0]]
        achieved = Counter(checked if basis == 'checked' else eligible)
        if rule == 'keep_gap' and basis != 'checked':
            achieved.update(gaps)
        prepared = [r for r, f in roles if (self.role_files(f)['填写读回'] and (self.role_files(f)['草稿读回'] or self.role_files(f)['无草稿说明']))]
        filling = {}
        for _, f in roles:
            files = self.role_files(f)
            if files['填写方案'] and not files['回执']:
                try:
                    fields = fill_plan.load(files['填写方案'][0]).get('字段')
                    if not isinstance(fields, list):
                        raise ValueError('字段 is not a list')
                    done = sum(1 for x in fields if isinstance(x, dict) and x.get('状态') in fill_plan.DONE)
                    filling[self.rel(f)] = '%d/%d 已读回' % (done, len(fields))
                except (OSError, ValueError, AttributeError, TypeError):
                    filling[self.rel(f)] = '填写方案无法解析'
        return {
            '批次': self.batch_id,
            '盘点状态': dict(Counter(statuses.values())),
            '已查公司': dict(checked), '有合格岗位的公司': dict(eligible), '留空公司': dict(gaps) if rule == 'keep_gap' else {},
            '需补位公司': dict(gaps) if rule == 'replace' else {}, '受阻公司': blocked_companies,
            '已准备表单': len(prepared), '填写进度': filling,
            '无草稿须保持页面': sum(1 for _, f in roles if self.role_files(f)['无草稿说明'] and not self.role_files(f)['回执']),
            '已提交且有回执': sum(1 for r, f in roles if r.get('投递状态') == '已提交' and self.role_files(f)['回执']),
            '结果不确定': sum(1 for _, f in roles if self.role_files(f)['结果不确定'] and not self.role_files(f)['回执']),
            '剩余目标': {b: (None if t is None else max(t - achieved[b], 0)) for b, t in targets.items()},
        }

    def closeout(self, report):
        reasons = []
        for company in self.scope:
            status = self.book.company_status(company)
            if status in ('', NOT_STARTED) and not self.blocked(self.company_dir(company))[0]:
                reasons.append(company + ' 盘点状态是「%s」且没有受阻记录：Agent 还有工作要做' % (status or '空'))
        roles, _ = self.started_roles()
        for row, folder in roles:
            files = self.role_files(folder)
            if files['回执'] or self.blocked(folder)[0]:
                continue
            if files['结果不确定']:
                reasons.append(self.rel(folder) + ' 结果不确定，尚未在申请中心核查')
            else:
                reasons.append(self.rel(folder) + ' 已开始但未提交也未记录受阻（等待用户批准也要写 受阻.md，解除方: 用户）')
        closing = self.dir / '批次' / '收尾.md'
        open_targets = [b for b, v in report['剩余目标'].items() if v is None or v > 0]
        kv, _ = parse(closing)
        if open_targets and not ref_exists(self.root, value(kv, '依据')):
            reasons.append('桶 ' + '、'.join(open_targets) + ' 目标未达成或未设数字目标：' + self.rel(closing) +
                           ' 需要「停止原因:」和指向用户确认的「依据:」')
        if not closing.is_file() or not value(kv, '保留页面'):
            reasons.append(self.rel(closing) + ' 需要「保留页面:」列出仍打开的公司页面（收尾不等于关页面）')
        return {'可以收尾': not reasons, '原因': reasons}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--workbook', required=True, type=Path)
    parser.add_argument('--batch', required=True)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--closeout', action='store_true')
    parser.add_argument('--where', action='store_true', help='print where evidence for a company/role goes')
    parser.add_argument('--company')
    parser.add_argument('--url')
    args = parser.parse_args()
    try:
        batch = Batch(args.workbook, args.batch, args.root)
    except Exception as exc:  # noqa: BLE001 - unreadable workbook
        print(json.dumps({'通过': False, '错误': ['工作簿无法读取：' + type(exc).__name__ + ' ' + str(exc)[:200]]}, ensure_ascii=False))
        return 2
    if args.where:
        out = {'批次目录': batch.rel(batch.dir), 'Query': batch.rel(batch.query_path)}
        if args.company:
            out['公司目录'] = batch.rel(batch.company_dir(args.company))
            if args.url:
                out['岗位目录'] = batch.rel(batch.role_dir(args.company, args.url))
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0
    errors = batch.errors + batch.consistency_errors()
    report = batch.report()
    result = {'通过': not errors, '错误': errors, '报告': report}
    if args.closeout:
        result['收尾'] = batch.closeout(report)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors and (not args.closeout or result['收尾']['可以收尾']) else 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
