"""Standalone benchmark visualization: matplotlib SVG/PNG plus filterable offline HTML."""
import html
import json
import statistics
from pathlib import Path


def render(report, out):
    from matplotlib import pyplot as plt
    sites = sorted({r['site'] for r in report['cases']})
    labels = ['Native bilingual', 'Search dropdown', 'Date / cascade', 'Repeated education', 'Upload / rerender']
    label_by_site = dict(zip(['native-bilingual', 'search-dropdown', 'date-cascade', 'repeated-education', 'upload-rerender'], labels))
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10})
    fig, axes = plt.subplots(2, 2, figsize=(13, 8), constrained_layout=True)
    for row, state in enumerate(('cold', 'warm')):
        for col, (metric, title) in enumerate((('median_seconds', 'Measured script + browser + receipt (seconds)'), ('median_text_tokens', 'Tokenized replay text (not billed LLM usage)'))):
            ax = axes[row][col]
            for offset, mode, color in ((-.18, 'baseline', '#64748b'), (.18, 'enhanced', '#0d9488')):
                values = [next(r[metric] for r in report['summary'] if r['site'] == site and r['mode'] == mode and r['cache_state'] == state) for site in sites]
                bars = ax.bar([i + offset for i in range(len(sites))], values, .36, color=color, label=mode)
                ax.bar_label(bars, fmt='%.2f' if col == 0 else '%.0f', padding=3, fontsize=8)
            ax.set_xticks(range(len(sites)), [label_by_site[s].replace(' ', '\n', 1) for s in sites], fontsize=8)
            ax.set_title(f'{state.capitalize()} — {title}', fontsize=10); ax.grid(axis='y', alpha=.2); ax.set_axisbelow(True)
            ax.set_ylim(0, ax.get_ylim()[1] * 1.12)
            if row == 0 and col == 0:
                ax.legend()
    fig.suptitle('REA-inspired form automation: paired mock benchmark\nSame existing fill executor; model reasoning and live browser lanes are unmeasured', fontsize=14)
    fig.savefig(out / 'comparison.svg'); fig.savefig(out / 'comparison.png', dpi=150); plt.close(fig)
    svg_path = out / 'comparison.svg'
    svg_path.write_bytes(('\n'.join(line.rstrip() for line in svg_path.read_text(encoding='utf-8').splitlines()) + '\n').encode('utf-8'))
    summary = report['summary']
    table_rows = []
    for site in sites:
        for state in ('cold', 'warm'):
            b = next(r for r in summary if r['site'] == site and r['cache_state'] == state and r['mode'] == 'baseline')
            e = next(r for r in summary if r['site'] == site and r['cache_state'] == state and r['mode'] == 'enhanced')
            savings = (1 - e['median_text_tokens'] / b['median_text_tokens']) * 100
            table_rows.append((site, state, b, e, savings))
    md = ['# Mock benchmark evaluation', '', f"Generated: {report['generated_at']}", '',
          f"{len(report['cases'])} measured applications; {report['methodology']['runs_per_cell']} repetitions per site × cache state × mode. All receipts checked against the mock server.", '',
          'Two cases mean the current batched Skill workflow versus deterministic semantic mapping. Cold/warm are separate strata. Baseline Agent decisions and complex-widget exception decisions are supplied by the synthetic fixture harness; no model was invoked.', '',
          '| Site | Cache | Baseline seconds | Enhanced seconds | Baseline text tokens | Enhanced text tokens | Text reduction |',
          '|---|---|---:|---:|---:|---:|---:|']
    for site, state, b, e, savings in table_rows:
        md.append(f'| {site} | {state} | {b["median_seconds"]:.3f} | {e["median_seconds"]:.3f} | {b["median_text_tokens"]:.0f} | {e["median_text_tokens"]:.0f} | {savings:.1f}% |')
    md.extend(['', 'Values are per-cell medians. Browser timings exclude navigation/startup, model reasoning and user approval. Additional deterministic validation may increase script time; this does not establish a production throughput improvement.', '',
               'Text token counts use pinned tiktoken/o200k_base on saved replay payloads. They exclude system/Skill context, repeated history, hidden reasoning, provider envelopes and cache billing. Actual provider consumption is null unless independent usage is imported. This run cannot establish billed token savings.', '',
               'Upload always triggers a fresh inventory. A warm initial cache does not exempt the resulting rerender from validation. Cached assignments never include profile values, role status, final approval or receipts.', '',
               'The mock harness runs real Chromium UI via the Playwright fallback executor. In-app/Chrome extension live throughput and optional REA deep-diagnostics overhead remain unmeasured. Passing these mocks does not prove a live employer accepts an application.', '',
               'Raw evidence: `results.json`, `results.csv` and `transcripts/*.json`; input source hashes and environment versions are in JSON. Reproduce with `python scripts/benchmark_forms.py --runs 5 --out <output>`.', '',
               '![Comparison](comparison.png)', ''])
    (out / 'evaluation.md').write_text('\n'.join(md), encoding='utf-8')
    safe_report = json.dumps(report, ensure_ascii=False).replace('<', '\\u003c')
    document = '''<!doctype html><html lang="zh"><meta charset="utf-8"><title>表单自动化对比</title>
    <style>body{font:16px system-ui;background:#f5f7fb;color:#163047;margin:32px auto;max-width:1200px;padding:0 20px}h1{font-size:30px}section{background:white;border-radius:14px;padding:22px;margin:20px 0}.note{border-left:5px solid #d97706;padding:14px;background:#fff7ed}select{padding:10px;margin-right:12px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #e2e8f0;padding:12px}img{width:100%}.bar{display:inline-block;height:8px;background:#0d9488;border-radius:4px}small{color:#64748b}</style>
    <h1>REA 表单工具 · 当前流程与增强流程</h1><p>5 种合成 ATS · 相同真实填写执行器 · 首次与缓存复用分开测量</p>
    <div class="note">耗时为本机脚本、浏览器、保存与回执实测；token 为测试交互文本的精确计数。未调用模型，真实模型消耗未测。这里不能得出真实投递吞吐提升的结论。</div>
    <section><label>缓存状态 <select id="cache"><option value="all">全部</option><option value="cold">首次 cold</option><option value="warm">复用 warm</option></select></label>
    <label>网站 <select id="site"><option value="all">全部网站</option></select></label><table><thead><tr><th>网站 / 状态</th><th>当前耗时</th><th>增强耗时</th><th>当前文本 token</th><th>增强文本 token</th><th>文本减少</th></tr></thead><tbody id="rows"></tbody></table></section>
    <section><img src="comparison.svg" alt="首次和复用下的执行时间与文本token对比"></section>
    <section><h2>记录范围</h2><p id="stats"></p><p>默认通道仍为内置浏览器与 Chrome 扩展；Playwright 是备用通道。本图仅覆盖备用执行器和跨通道的方案编译契约，未实测扩展通信延迟。复杂组件使用 mock 人工审核的真实点击路径，未知字段交回 AI。</p><p><a href="results.json">原始 JSON</a> · <a href="results.csv">逐次 CSV</a> · <a href="evaluation.md">评估说明</a></p><small>私有生产盘点与档案不能写入此报告；本页只有合成测试数据。</small></section>
    <script>const data=__REPORT__;const sites=[...new Set(data.cases.map(r=>r.site))];
    sites.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;document.getElementById('site').append(o)});
    function draw(){const tbody=document.getElementById('rows');tbody.replaceChildren();
    for(const site of sites)for(const state of ['cold','warm']){if(document.getElementById('site').value!=='all'&&document.getElementById('site').value!==site)continue;if(document.getElementById('cache').value!=='all'&&document.getElementById('cache').value!==state)continue;
    const b=data.summary.find(r=>r.site===site&&r.cache_state===state&&r.mode==='baseline'),e=data.summary.find(r=>r.site===site&&r.cache_state===state&&r.mode==='enhanced');const tr=document.createElement('tr');
    [site+' / '+state,b.median_seconds.toFixed(3)+' s',e.median_seconds.toFixed(3)+' s',b.median_text_tokens,e.median_text_tokens,((1-e.median_text_tokens/b.median_text_tokens)*100).toFixed(1)+'%'].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});tbody.append(tr)} }
    document.getElementById('stats').textContent=data.cases.length+' 次计时投递，回执成功 '+data.cases.filter(r=>r.receipt_verified).length+'/'+data.cases.length+'；每格 '+data.methodology.runs_per_cell+' 次，展示中位数。';
    document.getElementById('cache').onchange=draw;document.getElementById('site').onchange=draw;draw();</script></html>'''.replace('__REPORT__', safe_report)
    (out / 'dashboard.html').write_text(document, encoding='utf-8')
