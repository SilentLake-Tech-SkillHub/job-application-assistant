#!/usr/bin/env python3
"""Playwright lane executor: fill one form from its 填写方案.json, field by field, without stopping.

  playwright_fill.py --plan <岗位目录>/填写方案.json [--vault <私有档案.md>] [--url <表单链接>]
                     [--profile-dir <目录>] [--channel chrome|msedge] [--headless] [--cdp <http://127.0.0.1:9222>]
                     [--max-fields N] [--no-save]

* Starts a persistent browser profile (default <投递根目录>/.浏览器配置/playwright) so logins made
  there are kept between runs; or attaches to an existing browser with --cdp.
* Text, textarea, native select, checkbox and radio fields use Playwright's own input APIs
  (fill / select_option / check), which produce the browser's real input events. Custom dropdowns,
  dates and cascaders run the plan's 点击步骤 (real clicks on the actual options). Uploads use
  set_input_files. Nothing is assigned through page scripts.
* Every field is read back right away and its 状态 written to the plan before the next field, so an
  interrupted run resumes from the first unfinished field (already read-back fields are skipped).
* It never submits: steps whose target looks like a final-submission control are refused, both from
  the plan text and from the element's own text. The platform hook cannot see clicks made inside this
  script, which is why the refusal lives here as well.

Exit codes: 0 all fields read back (or waiting for the user), 1 some field failed its readback,
2 bad plan or arguments, 3 the page does not show the form (log in once in this profile first).
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fill_plan  # noqa: E402
from submit_words import submit_like_text  # noqa: E402
from evidence_layout import EVIDENCE_DIR  # noqa: E402

TRUE = ('true', '是', '勾选', '选中', 'yes', '1')


def find_root(start):
    here = Path(start).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / EVIDENCE_DIR).is_dir():
            return candidate
    return None


def locate(page, spec):
    exact = spec.get('exact', True)
    if spec.get('label'):
        loc = page.get_by_label(spec['label'], exact=exact)
    elif spec.get('role'):
        loc = page.get_by_role(spec['role'], name=spec.get('name'), exact=exact)
    elif spec.get('placeholder'):
        loc = page.get_by_placeholder(spec['placeholder'], exact=exact)
    elif spec.get('text'):
        loc = page.get_by_text(spec['text'], exact=exact)
    else:
        loc = page.locator(spec['css'])
    return loc.nth(spec['nth']) if isinstance(spec.get('nth'), int) else loc


class Refused(Exception):
    pass


def guard(loc):
    """Refuse a click on anything whose own text or value reads like a final submission."""
    texts = []
    for getter in (lambda: loc.inner_text(timeout=1000), lambda: loc.get_attribute('value', timeout=1000),
                   lambda: loc.get_attribute('aria-label', timeout=1000)):
        try:
            texts.append(getter() or '')
        except Exception:  # noqa: BLE001 - attribute absent / not an element with text
            pass
    if any(submit_like_text(t) for t in texts):
        raise Refused('拒绝点击：目标像最终提交按钮（提交只能在门禁和钩子之下由 Agent 单独点击）')


def option(page, text, timeout):
    """The one visible element for an option/date-cell text: role=option, then button, then exact text."""
    candidates = (page.get_by_role('option', name=text, exact=True), page.get_by_role('button', name=text, exact=True),
                  page.get_by_text(text, exact=True))
    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        for loc in candidates:
            visible = [loc.nth(i) for i in range(loc.count()) if loc.nth(i).is_visible()]
            if len(visible) == 1:
                return visible[0]
            if len(visible) > 1:
                raise ValueError('选项「%s」匹配到多个可见元素' % text)
        time.sleep(0.1)
    raise ValueError('找不到可见的选项「%s」' % text)


def run_steps(page, steps, timeout):
    for step in steps:
        (kind, arg), = step.items()
        if kind == '等待':
            page.wait_for_timeout(arg)
            continue
        loc = locate(page, arg) if kind == '点击' else option(page, arg, timeout)
        guard(loc)
        loc.click(timeout=timeout)


def read(loc, mode):
    if mode == '勾选':
        return 'true' if loc.is_checked() else 'false'
    if mode == '选中项':
        return loc.evaluate("e => e.options && e.selectedIndex >= 0 ? e.options[e.selectedIndex].text : ''")
    if mode == '文本':
        return loc.inner_text()
    try:
        return loc.input_value()
    except Exception:  # noqa: BLE001 - not an input: fall back to its text
        return loc.inner_text()


def matches(got, want, mode, control):
    got, want = str(got or '').strip(), str(want if want is not None else '').strip()
    if mode == '勾选':
        return got == ('true' if want.lower() in TRUE else 'false')
    if control == '上传' or mode == '文本':
        return bool(want) and Path(want).name in got if control == '上传' else bool(want) and want in got
    return got == want


def readback_target(page, field):
    control, method = field['控件'], field['填法']
    if method == '批量':
        target = locate(page, field['定位'])
        mode = {'文本': '值', '多行文本': '值', '原生下拉': '选中项'}.get(control, '勾选')
    elif method == '上传':
        target = locate(page, field['读回定位']) if field.get('读回定位') else locate(page, field['定位'])
        mode = '文本' if field.get('读回定位') else 'files'
    else:
        target, mode = locate(page, field['读回定位']), '值'
    return target, field.get('读回方式') or mode


def poll(page, field, value, wait_ms):
    """Read the field back until it matches or wait_ms passes (forms re-render after input)."""
    target, mode = readback_target(page, field)
    deadline = time.time() + wait_ms / 1000
    got = ''
    while True:
        try:
            got = (target.evaluate("e => e.files && e.files[0] ? e.files[0].name : ''") if mode == 'files' else read(target, mode))
        except Exception:  # noqa: BLE001 - element re-rendered mid-read
            got = ''
        if matches(got, value, mode if mode != 'files' else '文本', field['控件']):
            return True, got
        if time.time() > deadline:
            return False, got
        time.sleep(0.15)


def fill_field(page, field, value, timeout):
    control, method = field['控件'], field['填法']
    loc = locate(page, field['定位'])
    if method == '批量':
        if control in ('文本', '多行文本'):
            loc.fill(str(value), timeout=timeout)
            loc.blur(timeout=timeout)
        elif control == '原生下拉':
            loc.select_option(label=str(value), timeout=timeout)
        else:  # 复选 / 单选
            guard(loc)
            (loc.check if str(value).lower() in TRUE else loc.uncheck)(timeout=timeout)
    elif method == '上传':
        loc.set_input_files(str(value), timeout=timeout)
    else:  # 点击
        run_steps(page, field['点击步骤'], timeout)
    return poll(page, field, value, max(timeout, 2000))


def recheck(page, plan, vault, root, save_to):
    """Resume safety: a field cached as 已读回 is trusted only if the page still shows it.

    After an interruption the page may have been reloaded without saving, so cached progress is
    re-read first; anything the page no longer shows goes back to 待填 and is filled again.
    """
    reset = []
    for field in plan['字段']:
        if field.get('状态') != '已读回' or field.get('填法') == '用户':
            continue
        value = fill_plan.resolve(field, vault, root, plan.get('批次'))
        try:
            ok, _ = poll(page, field, value, 1200)
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            fill_plan.mark(plan, field['序号'], '待填')
            field['备注'] = '续跑复核：页面上已不是缓存的值（可能重载未保存），重新填写'
            reset.append(field['标签'])
    if reset:
        fill_plan.save(save_to, plan)
    return reset


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--vault', type=Path, help='私有个人信息档案（解析 值来源: 档案:<字段>）')
    parser.add_argument('--root', type=Path, help='投递根目录（默认向上找含 投递证据/ 的目录）')
    parser.add_argument('--url', help='表单链接（默认用方案里的 表单链接 / 岗位链接）')
    parser.add_argument('--profile-dir', type=Path)
    parser.add_argument('--channel', choices=['chrome', 'msedge'])
    parser.add_argument('--cdp', help='连接已在运行的浏览器（remote debugging 地址）')
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--max-fields', type=int, default=0, help='本次最多处理几个字段（分段执行）')
    parser.add_argument('--no-save', action='store_true', help='不执行方案里的保存步骤')
    parser.add_argument('--timeout', type=int, default=8000)
    args = parser.parse_args(argv)

    def finish(code, **out):
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return code

    try:
        plan = fill_plan.load(args.plan)
    except (OSError, ValueError) as exc:
        return finish(2, 通过=False, 错误=['填写方案无法读取：' + type(exc).__name__])
    errors = fill_plan.validate(plan, ready=True)
    if errors:
        return finish(2, 通过=False, 错误=errors)
    if plan.get('通道') != 'Playwright':
        return finish(2, 通过=False, 错误=['方案通道是「%s」：执行器只跑 Playwright 通道的方案（其他通道按 fill_plan.py actions 批量执行）' % plan.get('通道')])
    root = args.root or find_root(args.plan)
    if root is None:
        return finish(2, 通过=False, 错误=['找不到投递根目录（含 投递证据/ 的目录）'])
    vault = fill_plan.vault_values(args.vault) if args.vault else {}
    url = args.url or plan.get('表单链接') or plan['岗位链接']
    profile = args.profile_dir or (Path(root) / '.浏览器配置' / 'playwright')

    from playwright.sync_api import sync_playwright
    done_now, failed, waiting = [], [], []
    with sync_playwright() as pw:
        browser = None
        if args.cdp:
            browser = pw.chromium.connect_over_cdp(args.cdp)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
        else:
            profile.mkdir(parents=True, exist_ok=True)
            options = {'headless': args.headless}
            if args.channel:
                options['channel'] = args.channel
            elif os.environ.get('CHROME_EXECUTABLE'):
                options['executable_path'] = os.environ['CHROME_EXECUTABLE']
            context = pw.chromium.launch_persistent_context(str(profile), **options)
        try:
            page = next((p for p in context.pages if p.url.split('#')[0] == url.split('#')[0]), None)
            if page is None:
                page = context.new_page()
                page.goto(url)
            first = next((f for f in plan['字段'] if f.get('填法') != '用户'), None)
            if first is not None:
                try:
                    locate(page, first['定位']).first.wait_for(state='attached', timeout=args.timeout)
                except Exception:  # noqa: BLE001
                    return finish(3, 通过=False, 页面=page.url,
                                  错误=['页面上找不到第一个字段「%s」：可能需要先在这个浏览器配置里登录（登录态会保留），或表单链接不对' % first['标签']])
            rechecked = recheck(page, plan, vault, root, args.plan)
            budget = [args.max_fields or 10 ** 6]

            def fill_pending():
                for field in plan['字段']:
                    if field.get('状态') in fill_plan.DONE or field['标签'] in failed:
                        continue
                    if field.get('填法') == '用户':
                        if field.get('状态') != '需用户':
                            fill_plan.mark(plan, field['序号'], '需用户')
                            fill_plan.save(args.plan, plan)
                        if field['标签'] not in waiting:
                            waiting.append(field['标签'])
                        continue
                    if budget[0] <= 0:
                        return
                    deps = [f for f in plan['字段'] if f['序号'] in field.get('依赖', []) and f.get('状态') not in fill_plan.DONE]
                    if deps:
                        field['备注'] = '等待依赖字段：' + '、'.join(d['标签'] for d in deps)
                        fill_plan.save(args.plan, plan)
                        continue
                    budget[0] -= 1
                    value = fill_plan.resolve(field, vault, root, plan.get('批次'))
                    if value is None:
                        fill_plan.mark(plan, field['序号'], '需用户')
                        field['备注'] = '缺值：值来源 ' + str(field.get('值来源')) + ' 未找到，问用户后写进档案'
                        fill_plan.save(args.plan, plan)
                        waiting.append(field['标签'])
                        continue
                    try:
                        ok, got = fill_field(page, field, value, args.timeout)
                        fill_plan.mark(plan, field['序号'], '已读回' if ok else '不一致', str(got))
                        field.pop('备注', None) if ok else field.update({'备注': '读回与期望不一致：改用逐字输入或真实点击后重试'})
                    except Refused as exc:
                        fill_plan.mark(plan, field['序号'], '不一致', '')
                        field['备注'] = str(exc)
                        ok = False
                    except Exception as exc:  # noqa: BLE001 - keep going with the other fields
                        fill_plan.mark(plan, field['序号'], '不一致', '')
                        field['备注'] = '执行出错：' + type(exc).__name__ + ' ' + str(exc).splitlines()[0][:160]
                        ok = False
                    fill_plan.save(args.plan, plan)  # progress survives an interruption
                    if ok:
                        done_now.append(field['标签'])
                    else:
                        failed.append(field['标签'])

            fill_pending()
            # An upload's auto-parse (or any re-render) can overwrite fields filled earlier in this run:
            # read everything back once more and refill what changed, once.
            if not args.max_fields:
                again = recheck(page, plan, vault, root, args.plan)
                if again:
                    rechecked += again
                    fill_pending()
            left = fill_plan.pending(plan)
            saved = None
            if plan.get('保存步骤') and not args.no_save and not [f for f in left if f.get('填法') != '用户']:
                try:
                    run_steps(page, plan['保存步骤'], args.timeout)
                    saved = '已点击保存（重开表单逐字段读回后再写 草稿读回）'
                except Exception as exc:  # noqa: BLE001
                    saved = '保存失败：' + type(exc).__name__ + ' ' + str(exc).splitlines()[0][:160]
        finally:
            if browser is None:
                context.close()
    left = fill_plan.pending(plan)
    out = {'通过': not failed, '续跑复核重填': rechecked, '本次已读回': done_now, '不一致': failed, '需用户': waiting,
           '未完成': [f['标签'] for f in left], '保存': saved, '方案': str(args.plan)}
    return finish(1 if failed else 0, **out)


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
