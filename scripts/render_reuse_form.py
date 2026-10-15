"""Publish observed per-site three-arm costs and labeled arithmetic reuse projections."""
import argparse
import csv
import html
import io
import json
import math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from reuse_form_benchmark import ARMS, SITES

LABELS = {'no-rea': 'No REA / optimized', 'first-rea': 'First REA + validation', 'reuse': 'Verified rule reuse'}
COLORS = ['#64748b', '#3b82f6', '#0d9488']


def payback(a, b, c):
    """Minimum additional reuse count for B+N*C <= (N+1)*A; no reruns implied."""
    if a is None or b is None or c is None:
        return None
    if b <= a:
        return 0
    return max(0, math.ceil((b - a) / (a - c))) if a > c else None


def render(folder):
    data = json.loads((folder / 'results.json').read_bytes())
    audit = json.loads((folder / 'audit.json').read_bytes())
    if not audit['passed'] or audit['validated_cells'] != 15:
        raise ValueError('All fifteen cells must pass independent audit before publishing comparisons')
    results = {(r['site'], r['arm']): r for r in data['results']}
    summaries = {}
    for arm in ARMS:
        rows = [results[s, arm] for s in SITES]
        summaries[arm] = {'token_total': sum(r['usage']['total_tokens'] for r in rows),
            'wall_seconds': sum(r['wall_seconds'] for r in rows),
            'requests': sum(r['request_count'] for r in rows),
            'rea_calls': sum(r['verified_batch']['rea_calls'] for r in rows),
            'reused': sum(r['verified_batch']['rule_experiment']['rule_reused'] for r in rows)}
    a, b, c = [summaries[arm] for arm in ARMS]
    improvement = {'reuse_token_reduction_percent': 100 * (1 - c['token_total'] / a['token_total']),
        'reuse_time_reduction_percent': 100 * (1 - c['wall_seconds'] / a['wall_seconds']),
        'reuse_throughput_ratio': a['wall_seconds'] / c['wall_seconds'],
        'token_payback_additional_reuses': payback(a['token_total'], b['token_total'], c['token_total']),
        'time_payback_additional_reuses': payback(a['wall_seconds'], b['wall_seconds'], c['wall_seconds'])}
    summary = {'groups': summaries, 'comparison': improvement, 'audit_passed': True,
        'all_turns_tokens': sum(g['token_total'] for g in summaries.values()),
        'all_turns_seconds': sum(g['wall_seconds'] for g in summaries.values()),
        'projection_formula': 'B + N*C vs (N+1)*A; N=additional reuse cycles of the same five sites; arithmetic projection, not additional measurements'}
    (folder / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (folder / 'environment.json').write_text(json.dumps(data['environment'], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    output = io.StringIO()
    columns = ['site', 'arm', 'tokens', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens',
               'wall_seconds', 'requests', 'rea_calls', 'rule_reused']
    writer = csv.DictWriter(output, fieldnames=columns); writer.writeheader()
    for site in SITES:
        for arm in ARMS:
            r = results[site, arm]
            writer.writerow({'site': site, 'arm': arm, 'tokens': r['usage']['total_tokens'],
                **{k: r['usage'].get(k) for k in columns[3:7]}, 'wall_seconds': r['wall_seconds'],
                'requests': r['request_count'], 'rea_calls': r['verified_batch']['rea_calls'],
                'rule_reused': r['verified_batch']['rule_experiment']['rule_reused']})
    (folder / 'cases.csv').write_text(output.getvalue(), encoding='utf-8-sig')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10})
    fig, axs = plt.subplots(2, 2, figsize=(16, 10))
    x = np.arange(5); width = .25
    ticks = ['Native\nbilingual', 'Search\ndropdown', 'Date\ncascade', 'Repeated\neducation', 'Upload\nrerender']
    for ax, metric, title in ((axs[0, 0], 'tokens', 'Actual reported model tokens per application'),
                              (axs[0, 1], 'seconds', 'Full CLI wall time per application (seconds)')):
        for i, arm in enumerate(ARMS):
            values = [results[s, arm]['usage']['total_tokens'] if metric == 'tokens' else results[s, arm]['wall_seconds'] for s in SITES]
            bars = ax.bar(x + (i - 1) * width, values, width, label=LABELS[arm], color=COLORS[i])
            ax.bar_label(bars, labels=[f'{v/1000:.1f}k' if metric == 'tokens' else f'{v:.1f}' for v in values], fontsize=8, padding=3)
        ax.set_xticks(x, ticks); ax.set_title(title); ax.grid(axis='y', alpha=.2); ax.set_axisbelow(True)
        ax.margins(y=.18)
    axs[0, 0].legend(fontsize=9)
    for ax, metric, title in ((axs[1, 0], 'token_total', 'Total actual tokens: five applications per arm'),
                              (axs[1, 1], 'wall_seconds', 'Total full CLI seconds: five applications per arm')):
        values = [summaries[a][metric] for a in ARMS]
        bars = ax.bar(np.arange(3), values, color=COLORS, width=.6)
        ax.bar_label(bars, labels=[f'{v:,.0f}' if metric == 'token_total' else f'{v:,.2f}s' for v in values], padding=4)
        ax.set_xticks(np.arange(3), ['No REA\noptimized', 'First REA\n+ validation', 'Verified rule\nreuse'])
        ax.set_title(title); ax.grid(axis='y', alpha=.2); ax.set_axisbelow(True); ax.margins(y=.2)
    fig.suptitle('REA learning and cross-application rule reuse | gpt-5.6-sol / high\n'
        '15 independent real-model turns | same optimized workflow and readback / submission gates', fontsize=16)
    fig.tight_layout(rect=(0, 0, 1, .94))
    for ext in ('png', 'svg'): fig.savefig(folder / ('comparison.' + ext), dpi=160)
    plt.close(fig)
    fig, axs = plt.subplots(1, 2, figsize=(14, 4.8))
    n = np.arange(0, 11)
    for ax, metric, title in ((axs[0], 'token_total', 'Cumulative reported tokens (arithmetic projection)'),
                              (axs[1], 'wall_seconds', 'Cumulative full seconds (arithmetic projection)')):
        ax.plot(n, (n + 1) * a[metric], '-o', label='No REA: (N+1) * A', color=COLORS[0])
        ax.plot(n, b[metric] + n * c[metric], '-o', label='Learn once + reuse: B + N * C', color=COLORS[2])
        ax.set_title(title); ax.set_xlabel('Additional reuse cycles N (each cycle = the same five sites)')
        ax.legend(); ax.grid(alpha=.2)
    fig.suptitle('Projection uses one observed A/B/C cost per site; repeated cycles were NOT measured')
    fig.tight_layout()
    for ext in ('png', 'svg'): fig.savefig(folder / ('amortization.' + ext), dpi=160)
    plt.close(fig)
    names = {'no-rea': '无 REA（同样流程优化）', 'first-rea': '首次 REA＋规则验证保存', 'reuse': '后续验证规则复用'}
    lines = ['# REA 首次学习与跨投递复用：真实全链路测试', '',
        '同一 gpt-5.6-sol / high；五类 mock，每组五次独立模型回合，共 15 次；独立 usage、规则来源和门禁审计全部通过。', '',
        '| 组别 | 真实总 token | 完整总秒数 | 模型请求 | REA 调用 | 规则复用 |', '|---|---:|---:|---:|---:|---:|']
    for arm in ARMS:
        g = summaries[arm]
        lines.append(f"| {names[arm]} | {g['token_total']:,} | {g['wall_seconds']:.2f} | {g['requests']} | {g['rea_calls']} | {g['reused']}/5 |")
    lines += ['', f"复用相对无 REA 组：token 变化 {improvement['reuse_token_reduction_percent']:.1f}%（正数为减少）；完整耗时变化 {improvement['reuse_time_reduction_percent']:.1f}%（正数为减少）。", '',
        '| 网站 | 无 REA token | 首次 REA token | 复用 token | 无 REA 秒 | 首次 REA 秒 | 复用秒 |', '|---|---:|---:|---:|---:|---:|---:|']
    table_rows = []
    for s in SITES:
        rows = [results[s, arm] for arm in ARMS]
        line = f"| {s} | " + ' | '.join([f"{r['usage']['total_tokens']:,}" for r in rows] + [f"{r['wall_seconds']:.2f}" for r in rows]) + ' |'
        lines.append(line)
        table_rows.append('<tr><td>' + html.escape(s) + '</td>' + ''.join(f"<td>{r['usage']['total_tokens']:,}</td>" for r in rows) + ''.join(f"<td>{r['wall_seconds']:.2f}</td>" for r in rows) + '</tr>')
    errors = sum(x['tool_errors'] for x in audit['checks']); business = sum(x['business_rejections'] for x in audit['checks'])
    notes = [
        'A 保留与 B/C 相同的流程优化，禁用 REA 和派生规则；它不是历史原始无优化流程，不能混用历史 49.3%/53.5% 降幅。',
        'B 从空规则库开始，真实 REA 捕获、模型解读、复杂路径探索、新空白页完整重放、服务端草稿验证及规则保存均计入成本。首次强制捕获仅为学习实验，生产仍按需。',
        'C 新上下文/浏览器/工作区只读取对应 B 的实际验证规则。与 A 使用相同的新合成资料；相比 B，学校、日期及其他申请值和 DOM ID 改变。无会话继承、无另行缓存预热、无旧填写状态或批准。',
        '原生字段的通用语义映射本来已可自动完成，REA 不一定提供额外价值；规则命中仍实际执行当前输入、读回、草稿检查和提交门禁。IAB/Chrome 的规则核心可接线，但本次完整实测只覆盖现有 Playwright 备用适配器。',
        f'完整时间从 CLI 启动至回合退出，包含所有模型/网络等待、工具、REA、规则读写、重新验证和失败重试。记录工具错误 {errors} 次、业务拒绝 {business} 次，均保留；不以模型口头说明作为成功证据。',
        '真实总 token = input + output，cached input 属于 input、reasoning 属于 output，不重复累加。提供方缓存未控制，不把 token 比例换算为金额节省。',
        '所有三组都执行当前读回、服务端草稿核对、审核哈希批准、真实 Submit 门禁、实际 mock 提交、独立回执和 Excel 读回。人工批准显式模拟，调研/登录/验证码/人工等待/草稿重开恢复未测。',
        '每网站每组仅一次，反映模型决策和网络波动，不声称统计显著性。首次组与其他组的合成事实有意不同以检验参数化，字段/选项数和结构相同。',
        f"累计学习成本预测：B + N×C 对比 (N+1)×A。按本轮总量计算，token 在额外复用 {improvement['token_payback_additional_reuses']} 轮、时间在额外复用 {improvement['time_payback_additional_reuses']} 轮达到不高于无 REA（None 表示未能推得）。N 每轮为五网站各一次；这只是算术外推，不是额外实测，也不是计费金额盈亏。",
    ]
    lines += ['', '## 计量和解释边界', ''] + ['- ' + n for n in notes]
    lines += ['', '原始日志及规则在本机忽略的 private 目录；公开 usage、审计、SHA 和合成数据。历史报告仍保留。', '']
    (folder / 'evaluation.md').write_text('\n'.join(lines), encoding='utf-8')
    totals = ''.join(f"<tr><td>{names[arm]}</td><td>{summaries[arm]['token_total']:,}</td><td>{summaries[arm]['wall_seconds']:.2f}</td><td>{summaries[arm]['requests']}</td><td>{summaries[arm]['rea_calls']}</td></tr>" for arm in ARMS)
    page = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>REA 跨投递复用实测</title><style>body{font:16px system-ui;background:#f5f8fc;color:#172b40;max-width:1450px;margin:30px auto;padding:20px}section{background:white;border:1px solid #dce3ef;border-radius:14px;padding:24px;margin:20px 0}img{width:100%}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{border-bottom:1px solid #dae2ed;text-align:left;padding:10px}li{margin:12px 0}a{color:#075ca9}</style>'
    page += '<h1>REA 首次分析与跨投递复用：真实模型全链路测试</h1><p>gpt-5.6-sol / high · 5 类网站 × 3 组 · 15 次独立模型回合 · 全部通过独立审计</p>'
    page += '<section><h2>总体对比</h2><table><tr><th>组别</th><th>真实 token</th><th>完整秒数</th><th>模型请求</th><th>REA 调用</th></tr>' + totals + '</table></section>'
    page += '<section><img src="comparison.png" alt="五网站三组真实 token 和完整耗时"><p>每个网站均展示三组，没有均摊共享 token。</p></section>'
    page += '<section><h2>逐网站明细</h2><table><tr><th>网站</th><th>无 REA token</th><th>首次 REA token</th><th>复用 token</th><th>无 REA 秒</th><th>首次 REA 秒</th><th>复用秒</th></tr>' + ''.join(table_rows) + '</table></section>'
    page += '<section><h2>首次成本何时被复用抵消（算术预测）</h2><img src="amortization.png" alt="累计复用成本预测"><p>后续重复轮次未实测。</p></section>'
    page += '<section><h2>口径和限制</h2><ul>' + ''.join('<li>' + html.escape(n) + '</li>' for n in notes) + '</ul></section>'
    page += '<section>' + ' · '.join(f'<a href="{p}">{p}</a>' for p in ['evaluation.md', 'cases.csv', 'summary.json', 'results.json', 'audit.json', 'environment.json', 'comparison.svg']) + '<p><a href="../20261015-isolated/dashboard.html">历史原流程对照</a> · <a href="https://github.com/SilentLake-Tech-SkillHub/job-application-assistant/pull/29">PR #29</a></p></section></html>'
    (folder / 'dashboard.html').write_text(page, encoding='utf-8')
    return summary


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('report', type=Path)
    print(json.dumps(render(p.parse_args().report), ensure_ascii=False))
