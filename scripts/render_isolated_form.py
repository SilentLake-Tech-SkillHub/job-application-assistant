"""Render real per-site cold/warm usage and full CLI time; missing values stay unknown."""
import argparse
import csv
import html
import json
from pathlib import Path
from fixtures.form_sites import SITES

LABELS = {'baseline': '原无 REA', 'optimized': '优化后'}
SITE_LABELS = ['原生中英字段', '搜索下拉', '日期级联', '重复教育经历', '上传重渲染']


def fmt(value, decimals=2):
    if value is None:
        return '未返回'
    return f'{value:,.{decimals}f}' if isinstance(value, float) else f'{value:,}'


def change(before, after):
    if before is None or after is None or not before:
        return '未比较'
    value = (after / before - 1) * 100
    return ('增加 ' if value >= 0 else '减少 ') + f'{abs(value):.1f}%'


def render(folder):
    report = json.loads((folder / 'results.json').read_bytes())
    (folder / 'environment.json').write_text(json.dumps(report.get('environment', {}), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    audit_path = folder / 'audit.json'
    audit = json.loads(audit_path.read_bytes()) if audit_path.exists() else {}
    checked = {x['case_id'] for x in audit.get('checks', [])}
    checked_by_id = {x['case_id']: x for x in audit.get('checks', [])}
    rows = report['results']
    complete = len(rows) == 20 and audit.get('passed') and all(r['completed'] and r['complete_delivery_valid'] for r in rows)
    by_key = {(r['site'], r['cache_state'], r['mode']): r for r in rows}
    flat = []
    for r in rows:
        usage = r.get('usage') or {}
        cache = (r.get('verified_batch') or {}).get('isolated_case', {}).get('cache', {})
        flat.append({'case_id': r['case_id'], 'site': r['site'], 'cache_state': r['cache_state'], 'mode': r['mode'],
                     'model': r['model'], 'completed': r['completed'], 'audited': r['case_id'] in checked,
                     'wall_seconds_including_seed': r['wall_seconds'], 'seed_seconds': r.get('cache_seed_seconds'),
                     'wall_excluding_seed_seconds_derived': r.get('wall_excluding_seed_seconds'),
                     **{k: usage.get(k) for k in ('input_tokens','cached_input_tokens','uncached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens')},
                     'model_requests': r['request_count'], 'tool_errors': r['tool_timing']['errors'],
                     'business_rejection_returns': checked_by_id.get(r['case_id'], {}).get('business_rejection_returns'),
                     'rea_calls': (r.get('verified_batch') or {}).get('rea_calls'), 'rea_seconds': r['rea_cli_seconds'],
                     'semantic_cache_available': cache.get('available'), 'semantic_cache_consumed': cache.get('application_consumed')})
    if flat:
        with (folder / 'cases.csv').open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(flat[0])); writer.writeheader(); writer.writerows(flat)
    aggregate = []
    for state in ('cold', 'warm'):
        selected = {m: [r for r in rows if r['cache_state'] == state and r['mode'] == m] for m in LABELS}
        if not all(len(selected[m]) == 5 and all(r['completed'] and r.get('usage') for r in selected[m]) for m in LABELS):
            continue
        values = {m: {'total_tokens': sum(r['usage']['total_tokens'] for r in rs),
                      'full_seconds': sum(r['wall_seconds'] for r in rs),
                      'seed_seconds': sum(r.get('cache_seed_seconds') or 0 for r in rs),
                      'model_requests': sum(r['request_count'] for r in rs),
                      'rea_calls': sum(r['verified_batch']['rea_calls'] for r in rs)} for m, rs in selected.items()}
        aggregate.append({'cache_state': state, **values})
    totals = {'recorded_rounds': len(rows), 'reported_usage_rounds': sum(bool(r.get('usage')) for r in rows),
              'known_total_tokens': sum(r['usage']['total_tokens'] for r in rows if r.get('usage')) if any(r.get('usage') for r in rows) else None,
              'full_cli_seconds_sum': sum(r['wall_seconds'] for r in rows),
              'seed_seconds_included': sum(r.get('cache_seed_seconds') or 0 for r in rows),
              'mcp_errors': sum(r['tool_timing']['errors'] for r in rows),
              'business_rejection_returns': sum(c.get('business_rejection_returns', 0) for c in audit.get('checks', [])),
              'verified_readback_fields': sum(c['current_readback_fields'] for c in audit.get('checks', [])),
              'rea_calls_completed_rounds': sum((r.get('verified_batch') or {}).get('rea_calls', 0) for r in rows),
              'rea_seconds': sum(r['rea_cli_seconds'] for r in rows)}
    (folder / 'summary.json').write_text(json.dumps({'complete_and_audited': bool(complete), 'aggregates': aggregate, 'totals': totals}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    image = ''
    if complete:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from matplotlib.font_manager import FontProperties
        font_path = Path('C:/Windows/Fonts/msyh.ttc')
        chinese = font_path.exists()
        prop = FontProperties(fname=str(font_path)) if chinese else FontProperties()
        names = SITE_LABELS if chinese else ['Native\nbilingual', 'Search\ndropdown', 'Date\ncascade', 'Repeated\neducation', 'Upload\nrerender']
        fig, axes = plt.subplots(2, 2, figsize=(15, 9), layout='constrained')
        for row_index, state in enumerate(('cold', 'warm')):
            for column, metric in enumerate(('wall_seconds', 'total_tokens')):
                ax = axes[row_index, column]
                for i, mode in enumerate(LABELS):
                    values = [by_key[(site, state, mode)]['wall_seconds'] if metric == 'wall_seconds'
                              else by_key[(site, state, mode)]['usage']['total_tokens'] for site in SITES]
                    positions = [j + (i - .5) * .36 for j in range(5)]
                    ax.bar(positions, values, width=.36, color=('#64748b', '#0d9488')[i], label=LABELS[mode] if chinese else ('Original, no REA', 'Optimized')[i])
                    for x, value in zip(positions, values):
                        label = f'{value:.1f}' if metric == 'wall_seconds' else f'{value:,}'
                        ax.text(x, value, label, ha='center', va='bottom', fontsize=8)
                title = (f'{state} — 完整 CLI 耗时（包含本次预热）' if metric == 'wall_seconds' else f'{state} — 真实模型总 token（包含缓存输入）') if chinese else (state + (' — Full CLI seconds, including seed' if metric == 'wall_seconds' else ' — Actual model tokens, including cached input'))
                ax.set_title(title, fontproperties=prop, fontsize=12)
                ax.set_xticks(range(5), names, fontproperties=prop, fontsize=10)
                ax.set_ylabel(('秒' if metric == 'wall_seconds' else 'token') if chinese else ('Seconds' if metric == 'wall_seconds' else 'Reported tokens'), fontproperties=prop)
                ax.grid(axis='y', alpha=.15); ax.set_axisbelow(True); ax.margins(y=.22)
                ax.legend(prop=prop, fontsize=9)
        fig.suptitle('逐站 cold/warm 完整模型测试：20 个独立回合，每格一次，保留所有重试' if chinese else '20 independent real-model rounds | one observation per cell | retries retained', fontproperties=prop, fontsize=15)
        fig.savefig(folder / 'comparison.png', dpi=160); fig.savefig(folder / 'comparison.svg')
        svg = folder / 'comparison.svg'; svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
        plt.close(fig)
        image = '<img src="comparison.png" alt="逐网站 cold/warm：完整模型耗时和真实 token 四图">'
    comparison = []
    for site, name in zip(SITES, SITE_LABELS):
        for state in ('cold', 'warm'):
            a, b = (by_key.get((site, state, m)) for m in LABELS)
            tokens = [(r.get('usage') or {}).get('total_tokens') if r else None for r in (a,b)]
            seconds = [r['wall_seconds'] if r else None for r in (a,b)]
            values = [name, state, fmt(tokens[0]) if a else '待测', fmt(tokens[1]) if b else '待测', change(*tokens),
                      fmt(seconds[0]) if a else '待测', fmt(seconds[1]) if b else '待测', change(*seconds)]
            comparison.append('<tr>' + ''.join('<td>' + html.escape(str(x)) + '</td>' for x in values) + '</tr>')
    details = []
    for r in flat:
        values = [r['case_id'], '已核验' if r['audited'] else ('完成待核验' if r['completed'] else '失败'),
                  fmt(r['wall_seconds_including_seed']), fmt(r['seed_seconds']), fmt(r['wall_excluding_seed_seconds_derived']),
                  fmt(r['input_tokens']), fmt(r['cached_input_tokens']), fmt(r['uncached_input_tokens']),
                  fmt(r['output_tokens']), fmt(r['reasoning_output_tokens']), fmt(r['model_requests']),
                  r['tool_errors'], fmt(r['business_rejection_returns']), r['rea_calls'], fmt(r['rea_seconds']), r['semantic_cache_consumed']]
        details.append('<tr>' + ''.join('<td>' + html.escape(str(x)) + '</td>' for x in values) + '</tr>')
    known_tokens = [(r.get('usage') or {}).get('total_tokens') for r in rows]
    known_tokens = [v for v in known_tokens if v is not None]
    total_text = f'{sum(known_tokens):,}' if known_tokens else '未返回'
    receipts = sum(bool(r.get('verified_batch') and r['verified_batch'].get('closeout_gate')) for r in rows)
    rea_calls = sum((r.get('verified_batch') or {}).get('rea_calls', 0) for r in rows)
    intro = f"已记录 {len(rows)}/20 个独立模型回合；回执/台账/closeout {receipts}/20；独立核验 {len(checked)}/20。{len(known_tokens)} 个已返回 usage 的回合共 {total_text} token，已完成回合记录 REA {rea_calls} 次。" + ('全部完成并核验通过。' if complete else '尚未完整完成，不展示完整矩阵改善结论；未返回 usage 保留未知。')
    aggregate_html = []
    for pair in aggregate:
        a, b = pair['baseline'], pair['optimized']
        aggregate_html.append(f"<li>{pair['cache_state']} 五个独立回合之和：总 token {a['total_tokens']:,} → {b['total_tokens']:,}（{change(a['total_tokens'],b['total_tokens'])}）；完整时间 {a['full_seconds']:.2f} → {b['full_seconds']:.2f} 秒（{change(a['full_seconds'],b['full_seconds'])}）。</li>")
    notes = '''<ul>
<li><b>完整时间：</b>从 CLI 进程启动到模型回合结束及进程退出，含读取 Skill/档案、初始化、模型/网络等待、程序/UI、REA（如触发）、所有重试、草稿 GET/当前 UI 读回、模拟批准、实际 mock 提交、服务端回执和 Excel 读回。</li>
<li><b>cold/warm：</b>指语义结构缓存无/有预热，模型上下文两者都全新。warm 先用真实原生输入及当前读回生成验证缓存，关闭预热页、丢弃已填方案后再做正式申请；不预置复杂控件配方、不做额外 AI 预热。主图完整时间包含预热；明细另外列出实测预热和扣除该区间的派生时间。原流程的 warm 为负对照，具备同样的缓存构建前提但应用阶段不能消费它。</li>
<li><b>真实 token：</b>CLI turn.completed、独立会话累计与逐请求相加核对。input 含 cached input，output 含 reasoning，总量只加 input + output。语义 cold/warm 不控制提供方模型缓存，不将总 token 比例换算为金额。REA 自身不调用 LLM，证据解读已计入整轮实际 usage。</li>
<li><b>逐站独立：</b>每格一个新 CLI/浏览器/工作区，只有一个批准的合成岗位；20 格全部独立，不均摊共享 token。图中每个网站的柱子是该网站这一完整回合，五格相加是五个独立回合，不是此前共享上下文的五站批次。</li>
<li><b>验收：</b>每格真实 Query/Prepare/Review/Submit/Closeout、当前字段读回、审核哈希、服务器回执、Excel 读回；完整必需 Markdown 正文逐字匹配实际模型可见输出，要求零截断。模型口头声称不作为事实或成功证据。</li>
<li><b>失败计数：</b>MCP 错误指工具抛错；业务失败返回另计正常响应中的方案/读回/草稿失败。两类失败和所有额外探查均留在真实 usage 和完整时间中，不用成功回执掩盖中途失败。</li>
<li><b>范围：</b>相同 gpt-5.6-sol/high，冻结原执行器/增强前 Skill 与优化实现，交替两种流程的执行先后。使用现有 Playwright 备用通道；默认内置浏览器/Chrome 扩展仍需独立测试。真实求职调研、登录/验证码、人工等待未测；审核批准明确模拟，草稿重开恢复未测。</li>
<li><b>解释限制：</b>每格仅一次，模型探索、提示词理解、重试和网络波动都会影响结果；冷/热差值不能单独归因于语义缓存，流程间差值不能单独归因于 REA。当前 mapper 即使命中缓存仍重新盘点、核对语义并验证方案，不预设 warm 必然更快。</li>
</ul>'''
    findings_path = folder / 'quality-findings.json'
    findings = json.loads(findings_path.read_bytes()) if findings_path.exists() else []
    findings_html = '<section><h2>观察到的行为与局限</h2><ul>' + ''.join('<li>' + html.escape(x['finding']) + '</li>' for x in findings) + '</ul></section>' if findings else ''
    page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>逐站 cold/warm 真实全链路测试</title><style>body{font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;max-width:1500px;margin:30px auto;padding:0 24px;color:#142638;background:#f6f8fb}section{background:white;padding:24px;border:1px solid #dce4ec;border-radius:12px;margin:20px 0}.scroll{overflow:auto}table{border-collapse:collapse;min-width:1100px;font-size:14px}th,td{padding:10px;border-bottom:1px solid #dde4ec;text-align:left}img{width:100%;height:auto}li{margin:10px 0}a{color:#087d76}</style><h1>逐站 cold/warm：真实模型完整链路</h1><p>' + intro + '</p><p><a href="../20261015-baseline-optimized/dashboard.html">整批：原无 REA vs 优化后</a> · <a href="../20261015-optimized/dashboard.html">整批：旧增强 vs 优化后</a> · <a href="../20261014/dashboard.html">最初四图（脚本/交互文本）</a></p><section>' + image + '<h2>每网站 / 每缓存状态的真实对照</h2><div class="scroll"><table><thead><tr>' + ''.join('<th>' + x + '</th>' for x in ['网站','状态','原无 REA token','优化后 token','token 变化','原无 REA 秒','优化后秒','时间变化']) + '</tr></thead><tbody>' + ''.join(comparison) + '</tbody></table></div></section><section><h2>五个独立回合之和</h2><ul>' + ''.join(aggregate_html) + '</ul><p>这是各状态五个独立模型回合的实测合计，不能与共享上下文的整批测试直接混用。</p></section><section><h2>口径与完整性</h2>' + notes + '</section>' + findings_html + '<section><details><summary>20 格完整 usage、预热和工具明细</summary><div class="scroll"><table><thead><tr>' + ''.join('<th>' + x + '</th>' for x in ['回合','状态','完整秒','预热秒','扣预热秒（派生）','输入','其中缓存','未缓存输入','输出','其中推理','模型请求','MCP 错误','业务失败返回','REA 次数','REA 秒','语义缓存消费']) + '</tr></thead><tbody>' + ''.join(details) + '</tbody></table></div></details></section><p><a href="results.json">完整数值与逐请求 usage</a> · <a href="audit.json">独立核验</a> · <a href="cases.csv">20 格 CSV</a> · <a href="summary.json">汇总 JSON</a> · <a href="evaluation.md">评估文档</a></p></html>'
    page = page.replace('<p>' + intro + '</p>', '<p>' + intro + '</p><p>分组恢复为最初的 5 类网站 × cold/warm；左列现在是完整 CLI 耗时，右列是实际模型 usage，与早期脚本时长/交互文本计数的边界不同。</p>')
    page = page.replace(' · <a href="evaluation.md">', ' · <a href="environment.json">运行环境</a> · <a href="quality-findings.json">质量观察</a> · <a href="evaluation.md">')
    (folder / 'dashboard.html').write_text(page, encoding='utf-8')
    evaluation = '# 逐站 cold/warm 真实模型全链路测试\n\n' + intro + '\n\n'
    evaluation += '| 网站 | 状态 | 原无 REA token | 优化后 token | 原无 REA 秒 | 优化后秒 |\n|---|---|---:|---:|---:|---:|\n'
    for site, name in zip(SITES, SITE_LABELS):
        for state in ('cold', 'warm'):
            a, b = (by_key.get((site,state,m)) for m in LABELS)
            evaluation += f"| {name} | {state} | {fmt((a.get('usage') or {}).get('total_tokens')) if a else '待测'} | {fmt((b.get('usage') or {}).get('total_tokens')) if b else '待测'} | {fmt(a['wall_seconds']) if a else '待测'} | {fmt(b['wall_seconds']) if b else '待测'} |\n"
    evaluation += '\n' + notes.replace('<ul>','').replace('</ul>','').replace('<li>','\n- ').replace('</li>','').replace('<b>','**').replace('</b>','**')
    for pair in aggregate:
        a, b = pair['baseline'], pair['optimized']
        evaluation += f"\n\n{pair['cache_state']} 五个独立回合合计：真实总 token {a['total_tokens']:,} → {b['total_tokens']:,}（{change(a['total_tokens'], b['total_tokens'])}）；完整 CLI 时间 {a['full_seconds']:.2f} → {b['full_seconds']:.2f} 秒（{change(a['full_seconds'], b['full_seconds'])}）。\n"
    if complete:
        evaluation += f"\n20 回合真实总量 {totals['known_total_tokens']:,} token，完整 CLI 时间之和 {totals['full_cli_seconds_sum']:.2f} 秒，本地预热 {totals['seed_seconds_included']:.2f} 秒已经包含。记录 MCP 错误 {totals['mcp_errors']} 次、业务失败返回 {totals['business_rejection_returns']} 次，全部保留；当前字段读回 {totals['verified_readback_fields']} 个。真实 REA {totals['rea_calls_completed_rounds']} 次、{totals['rea_seconds']:.2f} 秒。\n"
    if findings:
        evaluation += '\n\n## 行为观察\n\n' + '\n'.join('- ' + f['finding'] for f in findings)
    (folder / 'evaluation.md').write_text(evaluation + '\n', encoding='utf-8')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('folder', type=Path)
    render(p.parse_args().folder.resolve())
