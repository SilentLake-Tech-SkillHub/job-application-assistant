#!/usr/bin/env python3
"""Render measured Codex usage and wall time, preserving unknown/failed runs."""
import argparse
import csv
import html
import json
from pathlib import Path


def render(folder):
    data = json.loads((folder / 'results.json').read_bytes())
    rows = data['results']
    baseline_optimized = data.get('comparison') == 'baseline-optimized'
    optimization = data.get('comparison') in ('optimization', 'baseline-optimized')
    labels = {'baseline': '原无 REA 流程', 'enhanced': '优化前增强流程' if optimization else 'REA 增强流程', 'optimized': '优化后流程'}
    fields = ['mode', 'model', 'completed', 'wall_seconds', 'to_batch_verified_seconds', 'input_tokens',
              'cached_input_tokens', 'uncached_input_tokens', 'output_tokens', 'reasoning_output_tokens',
              'total_tokens', 'request_count', 'rea_cli_seconds', 'verified_receipts']
    with (folder / 'comparison.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields); writer.writeheader()
        for r in rows:
            row = {k: r.get(k) for k in fields}
            row.update(r.get('usage') or {})
            row['verified_receipts'] = len((r.get('verified_batch') or {}).get('sites', {}))
            writer.writerow({k: row.get(k) for k in fields})
    def fmt(value, unit=''):
        if value is None:
            return '未返回'
        return (f'{value:,.2f}' if isinstance(value, float) else f'{value:,}') + unit
    table = []
    for r in rows:
        u = r.get('usage') or {}
        table.append('<tr>' + ''.join('<td>' + html.escape(str(v)) + '</td>' for v in [
            labels[r['mode']], r['model'] + ' / high', ('完成' if r.get('complete_delivery_valid', True) else '回执完成，文档传输无效') if r['completed'] else '失败',
            fmt(r['wall_seconds'], ' 秒'), fmt(r['to_batch_verified_seconds'], ' 秒'),
            fmt(u.get('input_tokens')), fmt(u.get('cached_input_tokens')), fmt(u.get('output_tokens')),
            fmt(u.get('reasoning_output_tokens')), fmt(u.get('total_tokens')),
            str(len((r.get('verified_batch') or {}).get('sites', {}))) + '/5']) + '</tr>')
    success = len(rows) == 2 and all(r['completed'] and r.get('usage') and r.get('complete_delivery_valid', True) for r in rows)
    summary = '正式模型测试尚未完成；失败轮没有返回的 usage 保持未知，不能写成 0。'
    if len(rows) == 2 and all(r['completed'] for r in rows) and any(not r.get('complete_delivery_valid', True) for r in rows):
        summary = '两轮回执已完成，但模型文档传输存在截断。真实消耗保留，不能作为完整指令条件下的公平效果比较。'
    interpretation = ''
    if success:
        a, b = rows
        token_delta = (b['usage']['total_tokens'] / a['usage']['total_tokens'] - 1) * 100
        time_delta = (b['wall_seconds'] / a['wall_seconds'] - 1) * 100
        subject = '优化后流程' if optimization else '增强流程'
        summary = f"本次配对实测：{subject}总 token {'增加' if token_delta >= 0 else '减少'} {abs(token_delta):.1f}%，完整耗时 {'增加' if time_delta >= 0 else '减少'} {abs(time_delta):.1f}%。两轮各验证 5/5 份回执。"
        if optimization:
            interpretation = f"两轮都是本次重新执行，使用相同 gpt-5.6-sol/high、合成资料、五类表单、备份浏览器执行器与验收条件。优化前代码和 Skill 固定在 {data['before_commit'][:12]}，保留原先主动调用 REA 的流程；优化后合并普通准备、上传重扫和例外批处理，文档只加载一次，REA 按失败/未知绑定触发。模型请求 {a['request_count']} → {b['request_count']} 次；真实 REA 调用 {a['verified_batch']['rea_calls']} → {b['verified_batch']['rea_calls']} 次，耗时 {a['rea_cli_seconds']:.2f} → {b['rea_cli_seconds']:.2f} 秒。保留五份当前字段读回、草稿验证、审核版本哈希、逐角色提交门禁、服务端回执与 Excel 读回。"
            if baseline_optimized:
                interpretation = interpretation.replace(f"优化前代码和 Skill 固定在 {data['before_commit'][:12]}，保留原先主动调用 REA 的流程", f"原无 REA 轮使用 {data['before_commit'][:12]} 的原输入执行器，Skill 固定在 REA 增强前 {data['baseline_commit'][:12]}，模型判断全部字段来源与控件路径；该轮不暴露 REA 或自动映射工具")
                interpretation += ' 优化后若同样零次 REA，本次改善来自程序化准备和减少往返，不能证明 REA 诊断的独立收益。历史无 REA 轮有指令截断，不混入此重新配对比较。'
            au, bu = a['usage'], b['usage']
            saved = au['total_tokens'] - bu['total_tokens']
            cached_saved = au['cached_input_tokens'] - bu['cached_input_tokens']
            cached_share = f'其中 {cached_saved / saved * 100:.1f}% 来自减少缓存输入的重复携带。' if saved > 0 else ''
            interpretation += f" 实报未缓存输入 {au['uncached_input_tokens']:,} → {bu['uncached_input_tokens']:,}，输出 {au['output_tokens']:,} → {bu['output_tokens']:,}；{cached_share}因此总 token 改善不能直接换算为费用改善。工具时间合并区间 {a['tool_timing']['union_seconds']:.2f} → {b['tool_timing']['union_seconds']:.2f} 秒，模型/网络/编排剩余时间 {a['model_network_orchestration_seconds']:.2f} → {b['model_network_orchestration_seconds']:.2f} 秒。优化后逐角色审核、提交和回执台账核验仍耗时 {b['tool_timing']['by_tool_seconds'].get('review_submit_batch', 0):.2f} 秒；没有省略这些检查。以上只描述这次时间分解，不能把差值全部归因于某个模块。"
        else:
            interpretation = f"本轮模型请求从 {a['request_count']} 次变为 {b['request_count']} 次；增强轮三次 REA 工具共耗时 {b['rea_cli_seconds']:.2f} 秒。程序减少了普通字段的人工映射决策，但本次没有减少模型往返总次数。REA 脚本证据、额外指南和持续重发的上下文均进入真实输入 usage。不能把先前 76%–90% 的交互文本减少当作全链路模型消耗节省。"
    detail = []
    for r in rows:
        phases = r['tool_timing']['by_tool_seconds']
        detail.append('<h3>' + labels[r['mode']] + '</h3><ul>' + ''.join(
            f'<li>{html.escape(name)}：{seconds:.3f} 秒</li>' for name, seconds in phases.items()) +
            f"<li>模型、网络和编排剩余时间：{r['model_network_orchestration_seconds']:.3f} 秒（不能等同于纯推理时间）</li>" +
            f"<li>工具调用 {r['tool_timing']['calls']} 次，工具错误 {r['tool_timing']['errors']} 次；所有重试均保留。</li></ul>")
    setup = []
    setup_tokens, setup_seconds = 0, 0.0
    for name in ('unavailable-model-attempts.json', 'tool-policy-attempts.json', 'truncated-delivery-attempts.json'):
        path = folder / name
        if path.is_file():
            attempt = json.loads(path.read_bytes())
            for r in attempt['results']:
                setup_seconds += r['wall_seconds']
                tokens = (r.get('usage') or {}).get('total_tokens')
                if tokens is not None:
                    setup_tokens += tokens
                receipts = len((r.get('verified_batch') or {}).get('sites', {}))
                issue = '指令输出被外层工具截断，不用于最终比较' if name.startswith('truncated') else '前置模型/工具配置失败'
                setup.append(f"<li>{html.escape(r['model'])} / {r['mode']}：{r['wall_seconds']:.2f} 秒，真实总 token {fmt(tokens)}；回执 {receipts}/5；{issue}。</li>")
    setup_section = ''
    if setup:
        formal_tokens = sum((r.get('usage') or {}).get('total_tokens') or 0 for r in rows)
        setup_section = '<section><h2>前置无效尝试（单独保留）</h2><p>模型/工具配置失败或文档传输不完整的尝试不用于正式比较。' + \
            f'已返回 usage 的额外消耗 {setup_tokens:,} token，尝试耗时 {setup_seconds:.2f} 秒。正式轮加这些失败尝试的已报告总消耗 {formal_tokens + setup_tokens:,} token。未返回 usage 的请求仍是未知。</p><ul>' + ''.join(setup) + \
            '</ul><p>未把失败尝试归为成功，未删掉其真实消耗；不混入两个已完成回合的工作流比较。开发会话、离线测试和 CI 的时间/token 不属于单次投递指标。</p></section>'
    image = ''
    progress_section = ''
    progress_note = ''
    if success:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), layout='constrained')
        x = [0, 1]; names = ['Original, no REA', 'Optimized'] if baseline_optimized else (['Before optimization', 'After optimization'] if optimization else ['Baseline', 'REA enhanced'])
        for i, r in enumerate(rows):
            u = r['usage']; cached = u.get('cached_input_tokens') or 0
            axes[0].bar(i, u['input_tokens'] - cached, color='#475569', label='Uncached input' if i == 0 else None)
            axes[0].bar(i, cached, bottom=u['input_tokens'] - cached, color='#94a3b8', label='Cached input' if i == 0 else None)
            axes[0].bar(i, u['output_tokens'], bottom=u['input_tokens'], color='#0d9488', label='Output (includes reasoning)' if i == 0 else None)
            axes[0].text(i, u['total_tokens'], f"{u['total_tokens']:,}", ha='center', va='bottom')
            tool = r['tool_timing']['union_seconds']
            axes[1].bar(i, tool, color='#0d9488', label='Measured tools + startup' if i == 0 else None)
            axes[1].bar(i, r['wall_seconds'] - tool, bottom=tool, color='#94a3b8', label='Model + network + orchestration' if i == 0 else None)
            axes[1].text(i, r['wall_seconds'], f"{r['wall_seconds']:.1f}s", ha='center', va='bottom')
        for ax in axes:
            ax.set_xticks(x, names); ax.grid(axis='y', alpha=.15); ax.set_axisbelow(True)
            ax.margins(y=.18); ax.legend(loc='upper center', bbox_to_anchor=(.5, -.13), fontsize=8)
        axes[0].set_title('Actual model tokens, entire five-form batch'); axes[0].set_ylabel('Reported tokens')
        axes[1].set_title('Complete CLI wall time, entire five-form batch'); axes[1].set_ylabel('Seconds')
        fig.suptitle('One paired real-model mock run | same model / high | 5 verified receipts per mode', fontsize=11)
        fig.savefig(folder / 'full-chain.png', dpi=160); fig.savefig(folder / 'full-chain.svg')
        svg = folder / 'full-chain.svg'; svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
        plt.close(fig)
        image = '<img src="full-chain.png" alt="真实模型 token 和完整耗时对比图">'
        if all(len(r.get('site_progress', [])) == 5 for r in rows):
            from full_chain_progress import timestamp_ns
            sites = [p['site'] for p in rows[0]['site_progress']]
            ticks = ['Native\nbilingual', 'Search\ndropdown', 'Date\ncascade', 'Repeated\neducation', 'Upload\nrerender']
            fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), layout='constrained')
            colors = ['#64748b', '#0d9488']
            progress_table = []
            with (folder / 'site-progress.csv').open('w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=['mode', 'site', 'batch_start_to_receipt_seconds', 'reported_cumulative_tokens', 'reported_request_count', 'receipt', 'isolated_site_tokens', 'isolated_site_wall_seconds'])
                writer.writeheader()
                for i, r in enumerate(rows):
                    by_site = {p['site']: p for p in r['site_progress']}
                    values = [by_site[s]['batch_start_to_receipt_seconds'] for s in sites]
                    axes[0].bar([j + (i - .5) * .36 for j in range(5)], values, width=.36, color=colors[i], label=names[i])
                    for j, v in enumerate(values):
                        axes[0].text(j + (i - .5) * .36, v, f'{v:.1f}', ha='center', va='bottom', fontsize=8)
                    start = timestamp_ns(r['started_utc'])
                    elapsed, cumulative, total = [0], [0], 0
                    for request in r['request_usage']:
                        total += request['usage']['total_tokens']
                        elapsed.append((timestamp_ns(request['timestamp']) - start) / 1e9)
                        cumulative.append(total)
                    axes[1].step(elapsed, cumulative, where='post', color=colors[i], label=names[i])
                    for p in r['site_progress']:
                        writer.writerow({'mode': r['mode'], **p})
                        progress_table.append('<tr>' + ''.join('<td>' + html.escape(str(v)) + '</td>' for v in [p['site'], labels[r['mode']], fmt(p['batch_start_to_receipt_seconds'], ' 秒'), fmt(p['reported_cumulative_tokens']), '通过', '未隔离测量', '未测']) + '</tr>')
            axes[0].set_xticks(range(5), ticks); axes[0].set_ylabel('Seconds since entire batch started')
            axes[0].set_title('Five sites: cumulative time to verified receipt')
            axes[1].set_title('Shared model usage: cumulative reported tokens')
            axes[1].set_xlabel('Seconds since entire batch started'); axes[1].set_ylabel('Reported tokens, including cached input')
            for ax in axes:
                ax.grid(axis='y', alpha=.15); ax.set_axisbelow(True); ax.margins(y=.2)
                ax.legend(loc='upper center', bbox_to_anchor=(.5, -.15), fontsize=8)
            fig.suptitle('Cumulative batch progress, NOT isolated per-site latency or tokens', fontsize=12)
            fig.savefig(folder / 'site-progress.png', dpi=160); fig.savefig(folder / 'site-progress.svg')
            svg = folder / 'site-progress.svg'; svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
            plt.close(fig)
            progress_note = '整批图每根柱子汇总五个网站；下方五网站图表示从同一批次启动到各站回执核验完成的累计时间，包含前置准备和其他网站等待，不是单站独立耗时。累计 token 是回执时 CLI 已报告的全批共享 usage，不是分配给该站的消耗，也不能把五行相加。模型可能在工具调用后才报告后续 usage，因此各站累计值不会等于最终总量。批量准备可能延迟首份回执，同时缩短整批完成时间。'
            progress_section = '<section><h2>5 类网站：累计进度与共享开销</h2><p>' + progress_note + '</p><img src="site-progress.png" alt="五类网站的累计回执时间与整批共享 token 累积曲线"><div class="scroll"><table><thead><tr>' + ''.join('<th>' + t + '</th>' for t in ['网站','流程','批次启动至本站回执','此时已报告累计 token','回执及台账','独立单站 time/token','单站 cold/warm 全链路']) + '</tr></thead><tbody>' + ''.join(progress_table) + '</tbody></table></div><p><a href="site-progress.csv">分网站进度 CSV</a></p></section>'
    notes = '''
<li><b>时间边界：</b>从启动 Codex CLI 到完整模型回合和进程退出；另列“批次核验完成”时间。包含 Skill/档案读取、浏览器/工作区初始化、模型与网络等待、DOM 观察、REA、填写/重试、草稿保存与读回、模拟审核批准、实际 mock 提交、服务端回执核验和 Excel 台账读回。</li>
<li><b>真实 token：</b>来自 CLI turn.completed，并与该轮独立会话 rollout 的 token_count 交叉核对。input 包含 cached input；output 包含 reasoning。总量 = input + output，不能再次加缓存或推理。每次请求重新携带的上下文按实际 usage 累计。</li>
<li><b>REA 口径：</b>增强轮在搜索下拉、日期级联、上传重渲染三类复杂表单主动调用真实 REA CLI，并把捕获的前端脚本交给模型判断。生产流程仍按需诊断。REA 自身不调用 LLM；解读其证据及后续推理的消耗已计入该轮真实 usage。没有凭文本长度虚构“REA 独立模型 token”。</li>
<li><b>可比范围：</b>当前已登录 Codex CLI、相同模型/high、两个独立新上下文、每轮相同五类 mock、相同输入事实和完成条件、共用现有 Playwright 备用执行器。现有轮由模型选择全部字段来源和控件路径；增强轮用程序映射普通字段，模型处理异常并解读 REA。</li>
<li><b>预置与模拟：</b>输入已是确认岗位清单、JD/资格/名额和档案事实；真实求职调研、登录、验证码、人工批准等待不在本轮范围。mock 审核确认显式模拟，未伪造真人耗时。草稿通过服务端 GET 并逐字段对照当前 UI，未计入离开后重开/恢复草稿。默认内置浏览器/Chrome 扩展的完整链路仍需独立测试。</li>
<li><b>解释限制：</b>每种流程仅一轮，顺序为现有→增强。结果可说明这次执行，不能推断稳定平均速度、显著性或真实招聘网站效果。账户额度/金额不从 token 数擅自换算。</li>'''
    if optimization:
        notes = notes.replace('<li><b>真实 token：</b>', '<li><b>完整文档传输：</b>两轮使用同样的 50,000-token 工具输出预算，核验 CLI 真实模型可见输出没有截断标记。完整传输是验收条件；文档截断的初次尝试及消耗单独保留。</li>\n<li><b>真实 token：</b>')
        notes = notes.replace('增强轮在搜索下拉、日期级联、上传重渲染三类复杂表单主动调用真实 REA CLI，并把捕获的前端脚本交给模型判断。生产流程仍按需诊断。',
                              '优化前沿用三类复杂表单主动调用真实 REA 的测试模式；优化后仅在正常 UI 探查仍无法确定绑定或实际失败时调用。同样成功的控件无需 REA，实际调用次数从日志核验。')
        notes = notes.replace('现有轮由模型选择全部字段来源和控件路径；增强轮用程序映射普通字段，模型处理异常并解读 REA。',
                              '两轮均程序映射普通字段、模型决定复杂点击；优化后合并往返、去重文档和已读回字段，并用条件诊断。差异包含整个优化组合，不能单独推断某项优化的贡献。')
        notes = notes.replace('顺序为现有→增强', '顺序为优化前→优化后')
        if baseline_optimized:
            notes = notes.replace('优化前沿用三类复杂表单主动调用真实 REA 的测试模式；优化后仅在正常 UI 探查仍无法确定绑定或实际失败时调用。', '原无 REA 轮不提供 REA，全部字段来源和复杂点击由模型判断；优化后仅在正常 UI 探查仍无法确定绑定或实际失败时调用。')
            notes = notes.replace('两轮均程序映射普通字段、模型决定复杂点击；优化后合并往返、去重文档和已读回字段，并用条件诊断。', '原无 REA 轮由模型选择全部字段来源和点击路径；优化后程序映射普通字段、合并往返、去重文档和已读回字段，并用条件诊断。')
            notes = notes.replace('顺序为优化前→优化后', '顺序为原无 REA→优化后')
    page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>真实模型全链路测试</title><style>body{font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif;color:#142638;background:#f6f8fb;margin:32px auto;max-width:1400px;padding:0 24px}h1{font-size:28px}section{background:white;padding:24px;border:1px solid #dce4ec;border-radius:12px;margin:20px 0}table{border-collapse:collapse;min-width:1250px;font-size:14px}td,th{padding:12px;text-align:left;border-bottom:1px solid #dde4ec}.scroll{overflow:auto}img{width:100%;height:auto}li{margin:10px 0}a{color:#087d76}</style><h1>真实模型全链路测试</h1><p>' + summary + '</p><section>' + image + '<div class="scroll"><table><thead><tr>' + ''.join('<th>' + t + '</th>' for t in ['流程','模型','状态','完整耗时','批次核验完成','输入 token','其中缓存输入','输出 token','其中推理输出','总 token','回执']) + '</tr></thead><tbody>' + ''.join(table) + '</tbody></table></div></section><section><h2>计量边界与读法</h2><ul>' + notes + '</ul></section><section><h2>工具执行时间明细</h2>' + ''.join(detail) + '</section><p><a href="results.json">完整数值与逐请求 usage</a> · <a href="comparison.csv">CSV</a> · <a href="evaluation.md">评估说明</a> · <a href="https://learn.chatgpt.com/docs/non-interactive-mode">Codex CLI 官方 usage 说明</a></p></html>'
    page = page.replace('<section><h2>计量边界与读法</h2>', progress_section + '<section><h2>计量边界与读法</h2>')
    if progress_section:
        coverage = '<section><h2>与最初四图的覆盖差异</h2><p>最初四图按 5 类网站 × cold/warm 展示脚本耗时和交互文本 token。cold/warm 指语义结构缓存未命中/预热，并非模型缓存计费。本报告新增真实模型整批 usage 和完整时间，恢复五网站累计进度，但尚未隔离测量单站 cold/warm 的完整模型成本；表中的未测项没有用早期代理指标或均摊数替代。</p><p><a href="../20261014/dashboard.html">最初四图：脚本与交互文本评测</a> · <a href="../20261015-optimized/dashboard.html">旧增强 vs 优化后</a> · <a href="../20261015-baseline-optimized/dashboard.html">原无 REA vs 优化后</a></p></section>'
        coverage = coverage.replace('</section>', '<p>后续逐站独立测量见：<a href="../20261015-isolated/dashboard.html">20 格 cold/warm 真实模型测试</a>。本页仍只描述其原始整批测量，完整度以对应报告为准。</p></section>')
        page = page.replace('<section><h2>5 类网站', coverage + '<section><h2>5 类网站')
    page = page.replace('<p><a href="results.json">', setup_section + '<p><a href="results.json">')
    if interpretation:
        page = page.replace('<h2>计量边界与读法</h2>', '<h2>如何解释这次结果</h2><p>' + interpretation + '</p><h2>计量边界与读法</h2>')
    page = page.replace(' · <a href="comparison.csv">', ' · <a href="audit.json">独立 usage / 回执 / REA 核验</a> · <a href="comparison.csv">')
    page = page.replace(' · <a href="evaluation.md">', ' · <a href="environment.json">实际运行环境</a> · <a href="evaluation.md">')
    (folder / 'dashboard.html').write_text(page, encoding='utf-8')
    evaluation = '# 真实模型全链路测试\n\n' + summary + '\n\n' + interpretation + '\n\n'
    for r in rows:
        evaluation += '## ' + labels[r['mode']] + '\n\n```json\n' + json.dumps({k: r[k] for k in ('model','completed','wall_seconds','to_batch_verified_seconds','usage','request_count','rea_cli_seconds','verified_batch')}, ensure_ascii=False, indent=2) + '\n```\n\n'
    evaluation += '\n'.join(line for line in notes.replace('<li>', '\n- ').replace('</li>', '').replace('<b>', '**').replace('</b>', '**').splitlines())
    if progress_note:
        evaluation += '\n\n## 五网站与未测项\n\n' + progress_note + '\n\n本页整批数据没有隔离单站 cold/warm；最初 cold/warm 只指语义结构缓存。详见 site-progress.csv，不能把累计值当作独立单站成本。后续另行执行的 [20 格独立模型测试](../20261015-isolated/evaluation.md) 单独报告。\n'
    evaluation += '\n\n用法和 usage 字段：[Codex 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。\n'
    if setup:
        evaluation += f'\n前置无效尝试额外已报告 {setup_tokens:,} token，{setup_seconds:.2f} 秒，保存在本目录 *-attempts.json。未知 usage 没有记为零；被截断指令的尝试即使有五份回执也不用于完整传输比较。\n'
    (folder / 'evaluation.md').write_text(evaluation, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('folder', type=Path)
    render(parser.parse_args().folder.resolve())
