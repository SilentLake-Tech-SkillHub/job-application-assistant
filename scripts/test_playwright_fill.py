#!/usr/bin/env python3
"""Playwright lane executor on the synthetic recruiting site (real headless Chromium).

Covers: login kept in a persistent profile, the whole form filled from 填写方案.json with per-field
readback, an interrupted run resumed from the cache (including a page reloaded without saving),
the draft-save step, refusing a submit-like click, and rejecting plans for other lanes.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE / 'fixtures'))
import fill_plan  # noqa: E402
from browser_session import connect, profile_endpoint  # noqa: E402
from synthetic_ats import serve  # noqa: E402

ENV = dict(os.environ, PYTHONIOENCODING='utf-8')
EXE = os.environ.get('CHROME_EXECUTABLE') or None

# This launcher is only for the owned synthetic interruption fixture. Its
# handshake means the child imported the real executor, not that a field is done.
EXECUTOR_LAUNCHER = """
import json, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import playwright_fill
Path(sys.argv[2]).write_text(json.dumps({'phase': 'executor_imported', 'pid': os.getpid()}), encoding='utf-8')
raise SystemExit(playwright_fill.main(sys.argv[3:]))
"""


def executor_diagnostics(process, path, phase, stdout, stderr):
    def captured(stream):
        stream.flush()
        stream.seek(0)
        return stream.read().decode('utf-8', errors='replace')[-12000:]

    try:
        states = [field.get('状态') for field in fill_plan.load(path)['字段']]
    except (OSError, ValueError, KeyError) as exc:
        states = {'read_error': type(exc).__name__}
    return {'phase': phase, 'returncode': process.poll(), 'field_states': states,
            'stdout': captured(stdout), 'stderr': captured(stderr)}


def decode_executor_result(result):
    """Keep failed synthetic-child diagnostics even when stdout is valid JSON."""
    out = json.loads(result.stdout)
    if not isinstance(out, dict):
        raise ValueError('executor result must be a JSON object')
    if result.returncode != 0:
        stderr = result.stderr or ''
        out['fixtureDiagnostics'] = {'returncode': result.returncode, 'stderr': stderr[-12000:],
                                     'stderrTruncated': len(stderr) > 12000}
    return result.returncode, out


def wait_for_executor_progress(process, path, ready_path, stdout, stderr,
                               ready_timeout=20, progress_timeout=45, interval=0.05):
    """Bound startup and actual first-field checkpoint separately; never infer success."""
    phase = 'executor_import'
    deadline = time.monotonic() + ready_timeout
    while True:
        if process.poll() is not None:
            raise AssertionError('executor exited before first-field readback: ' +
                                 json.dumps(executor_diagnostics(process, path, phase, stdout, stderr), ensure_ascii=False))
        if phase == 'executor_import':
            try:
                ready = json.loads(ready_path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                ready = None
            if ready == {'phase': 'executor_imported', 'pid': process.pid}:
                phase = 'first_field_readback'
                deadline = time.monotonic() + progress_timeout
        if phase == 'first_field_readback':
            try:
                fields = fill_plan.load(path)['字段']
            except (OSError, ValueError, KeyError):
                fields = []  # A concurrent checkpoint write is not completion.
            if fields and fields[0].get('状态') == '已读回':
                return
        if time.monotonic() >= deadline:
            raise AssertionError('executor progress timeout: ' +
                                 json.dumps(executor_diagnostics(process, path, phase, stdout, stderr), ensure_ascii=False))
        time.sleep(interval)


@contextmanager
def owned_process_exit_probe(pid):
    """Observe the fixture's CDP-reported browser PID; never terminate a browser."""
    if not isinstance(pid, int) or pid <= 0:
        raise AssertionError('invalid owned browser process ID')
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE only.
        if not handle:
            if ctypes.get_last_error() == 87:  # PID already gone.
                yield lambda: True
                return
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            def exited():
                result = kernel.WaitForSingleObject(handle, 0)
                if result == 0:
                    return True
                if result == 258:  # WAIT_TIMEOUT: still alive.
                    return False
                raise ctypes.WinError(ctypes.get_last_error())
            yield exited
        finally:
            kernel.CloseHandle(handle)
    else:
        def exited():
            try:
                waited, _ = os.waitpid(pid, os.WNOHANG)
                if waited == pid:
                    return True
            except ChildProcessError:
                pass  # The executor may have created this detached browser.
            try:
                os.kill(pid, 0)  # Existence check only, sends no signal.
            except ProcessLookupError:
                return True
            return False
        yield exited


def wait_for_owned_browser_exit(pid, probe, timeout=15, interval=0.05,
                                clock=time.monotonic, sleep=time.sleep):
    started = clock()
    while not probe():
        if clock() - started >= timeout:
            raise AssertionError('owned fixture browser exit timeout: ' + json.dumps(
                {'phase': 'browser_exit', 'browserPid': pid, 'browserExited': False,
                 'waitSeconds': clock() - started}, ensure_ascii=False))
        sleep(max(0, min(interval, timeout - (clock() - started))))
    return {'browserStarted': True, 'browserPid': pid, 'browserCloseAcknowledged': True,
            'browserExited': True, 'exitWaitSeconds': clock() - started}


def cleanup_owned_fixture(tmp, exit_evidence, timeout=5, interval=0.1,
                          clock=time.monotonic, sleep=time.sleep):
    if exit_evidence.get('browserExited') is not True or (
            exit_evidence.get('browserStarted') is not False and
            exit_evidence.get('browserCloseAcknowledged') is not True):
        raise AssertionError('fixture cleanup refused before verified browser exit: ' +
                             json.dumps(exit_evidence, ensure_ascii=False))
    started, attempts = clock(), 0
    while True:
        attempts += 1
        try:
            tmp.cleanup()
            if Path(tmp.name).exists():
                raise AssertionError('fixture cleanup returned with its directory still present')
            return {'cleanupAttempts': attempts, 'cleanupWaitSeconds': clock() - started}
        except PermissionError as exc:
            if getattr(exc, 'winerror', None) not in (5, 32):
                raise
            if clock() - started >= timeout:
                raise AssertionError('owned fixture cleanup remained locked: ' + json.dumps(
                    {'phase': 'temporary_profile_cleanup', **exit_evidence,
                     'attempts': attempts, 'waitSeconds': clock() - started,
                     'winerror': exc.winerror, 'lockedFile': Path(exc.filename).name if exc.filename else None},
                    ensure_ascii=False)) from exc
            sleep(max(0, min(interval, timeout - (clock() - started))))


def plan_for(base, job='101'):
    return {
        '方案版本': 1, '批次': 'pw', '公司': '合成公司', '岗位链接': base + '/jobs/' + job, '表单链接': base + '/apply/' + job,
        '通道': 'Playwright',
        '字段': [
            {'序号': 1, '标签': '简历附件 *', '定位': {'label': '简历附件 *'}, '控件': '上传', '填法': '上传', '值来源': '材料:简历',
             '读回定位': {'css': '#resume-name'}, '读回方式': '文本', '必填': True, '状态': '待填'},
            {'序号': 2, '标签': '姓名 *', '定位': {'label': '姓名 *'}, '控件': '文本', '填法': '批量', '值': '合成候选人', '必填': True, '状态': '待填'},
            {'序号': 3, '标签': '学历 *', '定位': {'role': 'combobox', 'name': '学历 *'}, '控件': '下拉', '填法': '点击', '值': '硕士',
             '点击步骤': [{'点击': {'role': 'combobox', 'name': '学历 *'}}, {'选项': '硕士'}], '读回定位': {'css': '.combo input'}, '必填': True, '状态': '待填'},
            {'序号': 4, '标签': '毕业时间 *', '定位': {'label': '毕业时间 *'}, '控件': '日期', '填法': '点击', '值': '2026-06',
             '点击步骤': [{'点击': {'label': '毕业时间 *'}}, {'选项': '2026-06'}], '读回定位': {'label': '毕业时间 *'}, '必填': True, '状态': '待填'},
            {'序号': 5, '标签': '项目经历 *', '定位': {'label': '项目经历 *'}, '控件': '多行文本', '填法': '批量',
             '值': '合成项目：负责 AI 产品需求、方案与迭代，指标提升 20%。', '必填': True, '状态': '待填'},
            {'序号': 6, '标签': '第一意向部门 *', '定位': {'label': '第一意向部门 *'}, '控件': '原生下拉', '填法': '批量', '值': '合成智能事业群',
             '必填': True, '状态': '待填'},
            {'序号': 7, '标签': '我已阅读并同意《合成隐私条款》 *', '定位': {'label': '我已阅读并同意《合成隐私条款》 *'}, '控件': '复选', '填法': '批量',
             '值': True, '必填': True, '状态': '待填'},
        ],
        '保存步骤': [{'点击': {'role': 'button', 'name': '保存草稿'}}],
    }


class Executor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        (cls.root / '投递证据' / 'pw' / '批次').mkdir(parents=True)
        (cls.root / '简历.pdf').write_bytes(b'%PDF synthetic resume')
        digest = hashlib.sha256((cls.root / '简历.pdf').read_bytes()).hexdigest()
        (cls.root / '投递证据' / 'pw' / '批次' / 'Query.md').write_text('## 材料\n- 简历 | 简历.pdf | ' + digest + '\n', encoding='utf-8')
        cls.base, cls.site, cls.server = serve()
        cls.profile = cls.root / '.浏览器配置' / 'playwright'

    @classmethod
    def tearDownClass(cls):
        exit_evidence = {'phase': 'browser_close', 'browserStarted': cls.profile.exists(),
                         'browserCloseAcknowledged': False, 'browserExited': False}
        try:
            # Both the profile and the endpoint come from this fixture's temp
            # directory. No user browser, arbitrary PID or system-wide kill.
            if not cls.profile.resolve().is_relative_to(cls.root.resolve()):
                raise AssertionError('browser profile is outside the owned fixture')
            endpoint = profile_endpoint(cls.profile)
            if endpoint:
                with sync_playwright() as pw:
                    browser = pw.chromium.connect_over_cdp(endpoint)
                    session = browser.new_browser_cdp_session()
                    browsers = [p for p in session.send('SystemInfo.getProcessInfo')['processInfo']
                                if p.get('type') == 'browser']
                    if len(browsers) != 1:
                        raise AssertionError('owned browser PID was not uniquely observed')
                    pid = browsers[0]['id']
                    exit_evidence['browserPid'] = pid
                    # Acquire the Windows process handle before asking it to
                    # exit. A closed CDP port alone does not release file locks.
                    with owned_process_exit_probe(pid) as probe:
                        session.send('Browser.close')
                        exit_evidence['browserCloseAcknowledged'] = True
                        exit_evidence.update(wait_for_owned_browser_exit(pid, probe))
            elif cls.profile.exists():
                raise AssertionError('owned profile exists but browser exit cannot be verified without its endpoint')
            else:
                exit_evidence.update(browserStarted=False, browserExited=True)
        except Exception as exc:
            raise AssertionError('owned browser teardown failed: ' +
                                 json.dumps(exit_evidence, ensure_ascii=False) + '; ' + str(exc)) from exc
        finally:
            cls.server.shutdown()
            cls.server.server_close()
        cleanup_owned_fixture(cls.tmp, exit_evidence)

    def run_exec(self, plan_path, *extra):
        r = subprocess.run([sys.executable, str(HERE / 'playwright_fill.py'), '--plan', str(plan_path), '--headless',
                            '--profile-dir', str(self.profile), '--timeout', '4000', *extra],
                           capture_output=True, text=True, encoding='utf-8', env=ENV, timeout=60)
        try:
            return decode_executor_result(r)
        except ValueError:
            self.fail('executor output not JSON:\n' + r.stdout + r.stderr)

    def write_plan(self, name, plan):
        folder = self.root / '投递证据' / 'pw' / '岗位' / name
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / fill_plan.PLAN_NAME
        fill_plan.save(path, plan)
        self.assertEqual(fill_plan.validate(plan, ready=True), [])
        return path

    def login_in_profile(self):
        with sync_playwright() as pw:
            _, ctx, _ = connect(pw, self.profile, headless=True, executable_path=EXE)
            page = ctx.new_page()
            page.goto(self.base + '/login')
            page.get_by_role('button', name='登录').click()  # browser-prefilled account; the script never logs in
            page.wait_for_url(self.base + '/center')

    def read_draft(self):
        with sync_playwright() as pw:
            _, ctx, _ = connect(pw, self.profile, headless=True, executable_path=EXE)
            page = ctx.new_page()
            page.goto(self.base + '/apply/101'); page.wait_for_selector('#save')
            out = {'姓名': page.get_by_label('姓名 *').input_value(), '学历': page.locator('.combo input').input_value(),
                   '毕业时间': page.get_by_label('毕业时间 *').input_value(), '项目经历': page.get_by_label('项目经历 *').input_value(),
                   '第一意向': page.get_by_label('第一意向部门 *').input_value(),
                   '条款': page.get_by_label('我已阅读并同意《合成隐私条款》 *').is_checked(), '附件': page.locator('#resume-name').inner_text()}
            page.close()  # Only the extra readback tab created by this fixture.
        return out

    @contextmanager
    def live_form(self, url):
        """Reconnect after executor exit, without recreating/navigating the page."""
        with sync_playwright() as pw:
            endpoint = profile_endpoint(self.profile)
            self.assertIsNotNone(endpoint, 'Executor exited and lost the browser')
            browser = pw.chromium.connect_over_cdp(endpoint)
            pages = [p for p in browser.contexts[0].pages if p.url == url]
            self.assertEqual(len(pages), 1)
            yield pages[0]

    def test_1_needs_login_in_the_profile_first(self):
        path = self.write_plan('login', plan_for(self.base))
        code, out = self.run_exec(path)
        self.assertEqual(code, 3, out)
        self.assertIn('登录', out['错误'][0])
        self.assertTrue(out['浏览器会话']['页面保留'])
        with self.live_form(self.base + '/login') as page:
            self.assertTrue(page.get_by_role('button', name='登录').is_visible())
        self.assertTrue(all(f['状态'] == '待填' for f in fill_plan.load(path)['字段']))

    def test_2_fill_interrupt_resume_and_save(self):
        self.login_in_profile()
        path = self.write_plan('main', plan_for(self.base))
        code, out = self.run_exec(path, '--max-fields', '3')  # interrupted after three fields
        self.assertEqual(code, 0, out)
        cached = fill_plan.load(path)
        self.assertEqual([f['状态'] for f in cached['字段']], ['已读回'] * 3 + ['待填'] * 4)
        self.assertEqual(out['保存'], None)  # nothing saved while fields are left
        # CLI process already exited: the same unsaved page must still exist.
        with self.live_form(self.base + '/apply/101') as page:
            self.assertEqual(page.get_by_label('姓名 *').input_value(), '合成候选人')
            # Simulate a user reload losing the unsaved draft; recovery must still work.
            page.reload(); page.wait_for_selector('#save')
        code, out = self.run_exec(path)
        self.assertEqual(code, 0, out)
        self.assertEqual(set(out['续跑复核重填']), {'简历附件 *', '姓名 *', '学历 *'})
        self.assertIn('已点击保存', out['保存'])
        final = fill_plan.load(path)
        self.assertTrue(all(f['状态'] == '已读回' for f in final['字段']), final)
        draft = self.read_draft()
        self.assertEqual(draft, {'姓名': '合成候选人', '学历': '硕士', '毕业时间': '2026-06',
                                 '项目经历': '合成项目：负责 AI 产品需求、方案与迭代，指标提升 20%。', '第一意向': '合成智能事业群',
                                 '条款': True, '附件': '简历.pdf'})  # the résumé parse pollution was corrected
        self.assertEqual(self.site.history, [])  # never submitted
        with self.live_form(self.base + '/apply/101') as page:
            self.assertEqual(page.get_by_label('项目经历 *').input_value(), plan_for(self.base)['字段'][4]['值'])
        out_md = fill_plan.export_readback(path)
        self.assertIn(fill_plan.plan_hash(path), out_md.read_text(encoding='utf-8'))
        # A third run finds everything on the page and does nothing.
        code, out = self.run_exec(path)
        self.assertEqual((code, out['续跑复核重填'], out['本次已读回']), (0, [], []))

    def test_3_refuses_a_submit_like_click(self):
        self.login_in_profile()
        plan = plan_for(self.base, '102')
        plan['字段'] = [dict(plan['字段'][1], 序号=1), {'序号': 2, '标签': '学历 *', '定位': {'css': '#form-root'}, '控件': '下拉', '填法': '点击', '值': '硕士',
                                                  '点击步骤': [{'点击': {'css': '#submit'}}], '读回定位': {'css': '.combo input'}, '状态': '待填'}]
        plan.pop('保存步骤')
        path = self.write_plan('refuse', plan)
        code, out = self.run_exec(path)
        self.assertEqual(code, 1, out)
        field = fill_plan.load(path)['字段'][1]
        self.assertEqual(field['状态'], '不一致')
        self.assertIn('拒绝点击', field['备注'])
        self.assertEqual(self.site.history, [])
        with self.live_form(self.base + '/apply/102') as page:
            self.assertTrue(page.locator('#submit').is_visible())

    def test_5_keyboard_fallback_cascade_reset_privacy_and_page_check(self):
        self.login_in_profile()
        vault = self.root / '档案.md'
        vault.write_text('| 字段 | 取值 |\n|---|---|\n| 手机号 | 13800000000 |\n', encoding='utf-8')
        query = self.root / '投递证据' / 'pw' / '批次' / 'Query.md'
        saved_query = query.read_text(encoding='utf-8')
        plan = {'方案版本': 1, '批次': 'pw', '公司': '合成公司', '岗位链接': self.base + '/jobs/lab', '表单链接': self.base + '/lab', '通道': 'Playwright',
                '字段': [
                    {'序号': 1, '标签': '城市 *', '定位': {'label': '城市 *'}, '控件': '文本', '填法': '批量', '值': '合成市', '必填': True, '状态': '待填'},
                    {'序号': 2, '标签': '省份 *', '定位': {'label': '省份 *'}, '控件': '原生下拉', '填法': '批量', '值': '合成省', '必填': True, '状态': '待填'},
                    {'序号': 3, '标签': '昵称 *', '定位': {'label': '昵称 *'}, '控件': '文本', '填法': '批量', '值': 'synthetic-nick', '必填': True, '状态': '待填'},
                    {'序号': 4, '标签': '手机号 *', '定位': {'label': '手机号 *'}, '控件': '文本', '填法': '批量', '值来源': '档案:手机号', '必填': True, '状态': '待填'}]}
        path = self.write_plan('lab', plan)
        # privacy-info-fill is not enabled in this batch: the phone field goes to the user.
        code, out = self.run_exec(path, '--vault', str(vault))
        self.assertEqual(code, 0, out)
        self.assertEqual(out['需用户'], ['手机号 *'])
        cached = fill_plan.load(path)
        self.assertEqual([f['状态'] for f in cached['字段']], ['已读回', '已读回', '已读回', '需用户'])
        self.assertIn('privacy-info-fill', cached['字段'][3]['备注'])
        self.assertIn('城市 *', out['续跑复核重填'])  # the province change cleared the city; the final recheck refilled it
        self.assertEqual(out['页面校验'], '未做（还有字段未读回）')
        # Enable privacy-info-fill: the phone is filled at run time and never written anywhere.
        query.write_text(saved_query + '\n## 自动化授权\n已开启: privacy-info-fill\n', encoding='utf-8')
        try:
            code, out = self.run_exec(path, '--vault', str(vault))
        finally:
            query.write_text(saved_query, encoding='utf-8')
        self.assertEqual(code, 0, out)
        final = fill_plan.load(path)
        self.assertTrue(all(f['状态'] == '已读回' for f in final['字段']), final)
        self.assertEqual(final['字段'][3]['读回'], '一致')
        self.assertEqual(final['页面校验']['结果'], '通过')
        self.assertTrue((path.parent / '填写截图.png').is_file())
        self.assertNotIn('13800000000', path.read_text(encoding='utf-8') + json.dumps(out, ensure_ascii=False))
        self.assertIn('页面校验: 通过', fill_plan.export_readback(path).read_text(encoding='utf-8'))

    def test_4_other_lanes_use_batch_actions_not_the_executor(self):
        plan = plan_for(self.base); plan['通道'] = 'Chrome'
        code, out = self.run_exec(self.write_plan('chrome', plan))
        self.assertEqual(code, 2)
        self.assertIn('fill_plan.py actions', out['错误'][0])

    def test_6_explicit_cdp_keeps_browser_and_unrelated_tab(self):
        self.login_in_profile()
        other_url = self.base + '/center?retained=1'
        with sync_playwright() as pw:
            _, context, endpoint = connect(pw, self.profile, headless=True, executable_path=EXE)
            other = context.new_page(); other.goto(other_url)
        plan = plan_for(self.base, '102')
        plan['字段'] = [plan['字段'][1]]
        plan.pop('保存步骤')
        code, out = self.run_exec(self.write_plan('external', plan), '--cdp', endpoint)
        self.assertEqual(code, 0, out)
        self.assertEqual(out['浏览器会话']['CDP'], endpoint)
        with self.live_form(other_url) as page:
            self.assertTrue(page.locator('#account').is_visible())
        with self.live_form(self.base + '/apply/102') as page:
            self.assertEqual(page.get_by_label('姓名 *').input_value(), '合成候选人')
        self.assertEqual(self.site.history, [])

    def test_7_no_draft_page_survives_repeated_executor_exit(self):
        self.login_in_profile()
        plan = plan_for(self.base)
        plan['字段'] = [dict(plan['字段'][4], 值='合成未保存内容')]
        plan.pop('保存步骤')
        path = self.write_plan('unsaved', plan)
        code, out = self.run_exec(path, '--no-save')
        self.assertEqual(code, 0, out)
        with self.live_form(self.base + '/apply/101') as page:
            self.assertEqual(page.get_by_label('项目经历 *').input_value(), '合成未保存内容')
        code, out = self.run_exec(path, '--no-save')
        self.assertEqual(code, 0, out)
        self.assertEqual(out['本次已读回'], [])
        with self.live_form(self.base + '/apply/101') as page:
            self.assertEqual(page.get_by_label('项目经历 *').input_value(), '合成未保存内容')
        self.assertEqual(self.site.history, [])

    def test_8_abrupt_executor_termination_keeps_unsaved_page(self):
        self.login_in_profile()
        plan = plan_for(self.base, '102')
        name, project = plan['字段'][1], plan['字段'][4]
        project.update(填法='点击', 点击步骤=[{'等待': 10000}, {'点击': project['定位']}], 读回定位=project['定位'])
        plan['字段'] = [name, project]; plan.pop('保存步骤')
        path = self.write_plan('killed', plan)
        # Establish readiness on this test's temporary profile and local mock
        # before starting the child. Never attach to a user/DS browser.
        with sync_playwright() as pw:
            _, context, endpoint = connect(pw, self.profile, headless=True, executable_path=EXE)
            target = self.base + '/apply/102'
            pages = [page for page in context.pages if page.url == target]
            self.assertLessEqual(len(pages), 1, 'synthetic role page must be unique')
            page = pages[0] if pages else context.new_page()
            if not pages:
                page.goto(target)
            page.get_by_label('姓名 *').wait_for(state='visible', timeout=10000)
        ready_path = path.parent / 'executor-ready.json'
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(
                [sys.executable, '-u', '-c', EXECUTOR_LAUNCHER, str(HERE), str(ready_path),
                 '--plan', str(path), '--headless', '--profile-dir', str(self.profile),
                 '--cdp', endpoint, '--no-save'],
                stdout=stdout, stderr=stderr, env=ENV)
            try:
                wait_for_executor_progress(process, path, ready_path, stdout, stderr)
                self.assertEqual(fill_plan.load(path)['字段'][0]['状态'], '已读回')
                self.assertIsNone(process.poll(), 'child must still be filling the delayed second field')
                process.terminate()  # Only this fixture's own filling process.
                process.wait(timeout=15)
                with self.live_form(target) as page:
                    self.assertEqual(page.get_by_label('姓名 *').input_value(), '合成候选人')
                self.assertEqual(self.site.history, [])
            except Exception as exc:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=15)
                details = executor_diagnostics(process, path, 'interruption_fixture_failure', stdout, stderr)
                raise AssertionError(str(exc) + '\nFinal executor diagnostics: ' +
                                     json.dumps(details, ensure_ascii=False)) from exc
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=15)



class ProgressHandshakeTests(unittest.TestCase):
    def exercise(self, code, check, **timeouts):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'plan.json'
            ready = Path(folder) / 'ready.json'
            path.write_text(json.dumps({'字段': [{'状态': '待填'}]}), encoding='utf-8')
            with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
                process = subprocess.Popen([sys.executable, '-u', '-c', code, str(path), str(ready)],
                                           stdout=stdout, stderr=stderr, env=ENV)
                try:
                    check(process, path, ready, stdout, stderr, timeouts)
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=10)

    def test_import_handshake_alone_cannot_count_as_first_field_readback(self):
        code = """
import json, os, sys, time
from pathlib import Path
Path(sys.argv[2]).write_text(json.dumps({'phase': 'executor_imported', 'pid': os.getpid()}), encoding='utf-8')
print('fixture is imported but has not filled a field', flush=True)
time.sleep(5)
"""
        def check(process, path, ready, stdout, stderr, timeouts):
            with self.assertRaisesRegex(AssertionError, 'progress timeout') as caught:
                wait_for_executor_progress(process, path, ready, stdout, stderr,
                                           ready_timeout=5, progress_timeout=0.15)
            self.assertIn('first_field_readback', str(caught.exception))
            self.assertIn('待填', str(caught.exception))
            self.assertIn('fixture is imported', str(caught.exception))
            self.assertIn('"returncode": null', str(caught.exception))
        self.exercise(code, check)

    def test_early_exit_preserves_code_and_both_output_streams(self):
        code = "print('fixture stdout', flush=True); import sys; print('fixture stderr', file=sys.stderr, flush=True); raise SystemExit(7)"
        def check(process, path, ready, stdout, stderr, timeouts):
            with self.assertRaisesRegex(AssertionError, 'exited before first-field readback') as caught:
                wait_for_executor_progress(process, path, ready, stdout, stderr, ready_timeout=5)
            for value in ['"returncode": 7', 'fixture stdout', 'fixture stderr', 'executor_import']:
                self.assertIn(value, str(caught.exception))
        self.exercise(code, check)

    def test_missing_import_handshake_times_out_in_its_own_phase(self):
        def check(process, path, ready, stdout, stderr, timeouts):
            with self.assertRaisesRegex(AssertionError, 'progress timeout') as caught:
                wait_for_executor_progress(process, path, ready, stdout, stderr, ready_timeout=0.15)
            self.assertIn('executor_import', str(caught.exception))
            self.assertIn('待填', str(caught.exception))
        self.exercise('import time; time.sleep(5)', check)

    def test_actual_checkpoint_releases_handshake_only_while_child_is_alive(self):
        code = """
import json, os, sys, time
from pathlib import Path
Path(sys.argv[2]).write_text(json.dumps({'phase': 'executor_imported', 'pid': os.getpid()}), encoding='utf-8')
Path(sys.argv[1]).write_text(json.dumps({'字段': [{'状态': '已读回'}]}), encoding='utf-8')
time.sleep(5)
"""
        def check(process, path, ready, stdout, stderr, timeouts):
            wait_for_executor_progress(process, path, ready, stdout, stderr, ready_timeout=5)
            self.assertIsNone(process.poll())
            self.assertEqual(fill_plan.load(path)['字段'][0]['状态'], '已读回')
        self.exercise(code, check)


class ExecutorOutputDiagnosticsTests(unittest.TestCase):
    def test_failure_keeps_original_json_error_and_actual_child_stderr(self):
        result = subprocess.CompletedProcess(['synthetic-executor'], 2,
                                             json.dumps({'通过': False, '错误': ['TimeoutError']}),
                                             'actual synthetic child traceback\n')
        code, out = decode_executor_result(result)
        self.assertEqual(code, 2)
        self.assertEqual(out['错误'], ['TimeoutError'])
        self.assertEqual(out['fixtureDiagnostics']['stderr'], result.stderr)
        self.assertFalse(out['fixtureDiagnostics']['stderrTruncated'])

    def test_success_is_unchanged_and_failure_output_is_bounded(self):
        expected = {'通过': True}
        code, out = decode_executor_result(subprocess.CompletedProcess([], 0, json.dumps(expected), 'warning'))
        self.assertEqual((code, out), (0, expected))
        _, out = decode_executor_result(subprocess.CompletedProcess([], 7, '{}', 'x' * 20000))
        self.assertEqual(out['fixtureDiagnostics']['returncode'], 7)
        self.assertEqual(len(out['fixtureDiagnostics']['stderr']), 12000)
        self.assertTrue(out['fixtureDiagnostics']['stderrTruncated'])


class FixtureTeardownTests(unittest.TestCase):
    class Clock:
        def __init__(self):
            self.value = 0

        def now(self):
            return self.value

        def sleep(self, duration):
            self.value += duration

    def test_browser_exit_wait_observes_real_exit_before_granting_cleanup(self):
        clock = self.Clock()
        result = wait_for_owned_browser_exit(123, lambda: clock.value >= 0.2,
                                            clock=clock.now, sleep=clock.sleep)
        self.assertTrue(result['browserExited'])
        self.assertTrue(result['browserCloseAcknowledged'])
        self.assertGreaterEqual(result['exitWaitSeconds'], 0.2)

    def test_windows_process_handle_waits_for_exit_and_is_always_closed(self):
        import ctypes
        from ctypes import wintypes  # Load the portable type declarations before patching os.name.
        from types import SimpleNamespace
        from unittest.mock import patch
        calls, results = [], iter([258, 0])
        kernel = SimpleNamespace(
            OpenProcess=lambda access, inherit, pid: calls.append(('open', access, inherit, pid)) or 456,
            WaitForSingleObject=lambda handle, wait: calls.append(('wait', handle, wait)) or next(results),
            CloseHandle=lambda handle: calls.append(('close', handle)) or True)
        with patch.object(os, 'name', 'nt'), patch.object(ctypes, 'WinDLL', return_value=kernel, create=True):
            with owned_process_exit_probe(123) as probe:
                self.assertFalse(probe())
                self.assertTrue(probe())
        self.assertEqual(calls, [('open', 0x00100000, False, 123), ('wait', 456, 0),
                                 ('wait', 456, 0), ('close', 456)])

    def test_windows_pid_already_gone_is_not_confused_with_a_live_process(self):
        import ctypes
        from ctypes import wintypes
        from types import SimpleNamespace
        from unittest.mock import patch
        kernel = SimpleNamespace(OpenProcess=lambda *args: 0,
                                 WaitForSingleObject=lambda *args: self.fail('no handle exists'),
                                 CloseHandle=lambda *args: self.fail('no handle to close'))
        with patch.object(os, 'name', 'nt'), patch.object(ctypes, 'WinDLL', return_value=kernel, create=True), \
                patch.object(ctypes, 'get_last_error', return_value=87, create=True):
            with owned_process_exit_probe(123) as probe:
                self.assertTrue(probe())

    def test_browser_exit_timeout_is_a_failure_with_process_diagnostics(self):
        clock = self.Clock()
        with self.assertRaisesRegex(AssertionError, 'browser exit timeout') as caught:
            wait_for_owned_browser_exit(123, lambda: False, timeout=0.2,
                                        clock=clock.now, sleep=clock.sleep)
        self.assertIn('"browserPid": 123', str(caught.exception))
        self.assertIn('"browserExited": false', str(caught.exception))

    def test_cleanup_is_refused_without_both_close_acknowledgement_and_exit(self):
        class Untouched:
            def cleanup(self):
                raise AssertionError('must not clean a live browser profile')
        for evidence in [{'browserExited': False}, {'browserStarted': True, 'browserExited': True}]:
            with self.assertRaisesRegex(AssertionError, 'cleanup refused'):
                cleanup_owned_fixture(Untouched(), evidence)

    def test_transient_windows_sharing_lock_retries_only_after_verified_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'owned'
            target.mkdir()
            class Locked:
                name = str(target)
                attempts = 0

                def cleanup(self):
                    self.attempts += 1
                    if self.attempts < 3:
                        error = PermissionError(13, 'fixture sharing violation', str(target / 'lock.tmp'))
                        error.winerror = 32
                        raise error
                    target.rmdir()
            clock, tmp = self.Clock(), Locked()
            result = cleanup_owned_fixture(tmp, {'browserStarted': True, 'browserCloseAcknowledged': True,
                                                 'browserExited': True}, clock=clock.now, sleep=clock.sleep)
            self.assertEqual(result['cleanupAttempts'], 3)
            self.assertFalse(target.exists())

    def test_persistent_windows_lock_is_not_ignored(self):
        class Locked:
            name = 'synthetic-owned-directory'

            def cleanup(self):
                error = PermissionError(13, 'fixture sharing violation', 'profile-lock.tmp')
                error.winerror = 32
                raise error
        clock = self.Clock()
        with self.assertRaisesRegex(AssertionError, 'cleanup remained locked') as caught:
            cleanup_owned_fixture(Locked(), {'browserStarted': True, 'browserCloseAcknowledged': True,
                                             'browserExited': True}, timeout=0.2,
                                  clock=clock.now, sleep=clock.sleep)
        for expected in ['"winerror": 32', 'profile-lock.tmp', 'temporary_profile_cleanup', '"browserExited": true']:
            self.assertIn(expected, str(caught.exception))

    def test_successful_cleanup_must_actually_remove_the_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            class NoOp:
                name = folder

                def cleanup(self):
                    pass
            with self.assertRaisesRegex(AssertionError, 'directory still present'):
                cleanup_owned_fixture(NoOp(), {'browserStarted': False, 'browserExited': True})


if __name__ == '__main__':
    unittest.main()
