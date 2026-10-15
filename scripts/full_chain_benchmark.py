#!/usr/bin/env python3
"""Two real Codex CLI model-driven mock batches; never run paid AI in ordinary CI.

Use saved Codex login without reading/copying credentials. Private events stay under test-results.
All published tokens come from Codex usage, not tokenized text or estimated reasoning.
"""
import argparse
import collections
import datetime
import hashlib
import importlib.metadata
import io
import json
import os
import queue
import platform
import subprocess
import sys
import threading
import time
import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BASELINE = 'ef9b403003ecb96004f27443842711be44f6ef86'
OPTIMIZATION_BEFORE = '00aaeb8fb7751af1ee4b42c2e85fb60d64f977d8'
DEFAULT_REA = Path(os.environ.get('LOCALAPPDATA', '')) / 'npm-cache/_npx/dea9475797100b20/node_modules/rea-agents/scripts/rea.mjs'
DEFAULT_CODEX = Path(os.environ.get('APPDATA', '')) / 'npm/node_modules/@openai/codex/bin/codex.js'
COMPARISONS = {'baseline-enhanced': ('baseline', 'enhanced'),
               'optimization': ('enhanced', 'optimized'),
               'baseline-optimized': ('baseline', 'optimized')}


def read_jsonl(path):
    if not Path(path).is_file():
        return []
    values = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        try:
            values.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a still-running process may have an incomplete final line
    return values


def truncated_outputs(records):
    findings = []
    for record in records:
        p = record.get('payload', {})
        if record.get('type') != 'response_item' or p.get('type') not in ('custom_tool_call_output', 'function_call_output'):
            continue
        output = p.get('output', '')
        blocks = output if isinstance(output, list) else [{'text': str(output)}]
        if any(str(b.get('text', '')).lstrip().startswith('Warning: truncated output') for b in blocks if isinstance(b, dict)):
            findings.append({'timestamp': record.get('timestamp'), 'type': p['type']})
    return findings


def normalize_usage(raw):
    """Subset fields are not added to the total. Missing fields remain unknown."""
    keys = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens')
    result = {k: raw.get(k) for k in keys}
    for k, v in result.items():
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 0):
            raise ValueError('Invalid provider usage: ' + k)
    inp, cached, out, reasoning = (result[k] for k in keys[:4])
    if cached is not None and inp is not None and cached > inp:
        raise ValueError('Cached input exceeds input')
    if reasoning is not None and out is not None and reasoning > out:
        raise ValueError('Reasoning exceeds output')
    result['total_tokens'] = inp + out if inp is not None and out is not None else None
    result['uncached_input_tokens'] = inp - cached if inp is not None and cached is not None else None
    return result


def usage_from_events(events):
    completed = [e for e in events if e.get('type') == 'turn.completed']
    # One exec invocation creates one turn; failed turns may still have partial rollout usage.
    if len(completed) > 1:
        raise ValueError('Unexpected multiple turns; do not silently drop usage')
    return normalize_usage(completed[-1]['usage']) if completed else None


def rollout_usage(path):
    records, last_total = [], None
    seen = set()
    for e in read_jsonl(path):
        payload = e.get('payload', {})
        if e.get('type') != 'event_msg' or payload.get('type') != 'token_count':
            continue
        info = payload.get('info') or {}
        total = info.get('total_token_usage')
        if not total:
            continue
        key = tuple(sorted(total.items()))
        if key in seen:
            continue  # repeated notification of the same cumulative usage
        seen.add(key)
        raw = info.get('last_token_usage')
        records.append({'timestamp': e.get('timestamp'), 'usage': normalize_usage(raw) if raw else None})
        last_total = normalize_usage(total)
    return {'usage': last_total, 'requests': records, 'request_count': len(records)}


def tool_time(events):
    complete = [e for e in events if e.get('kind') == 'tool_completed']
    grouped = collections.defaultdict(float)
    intervals = []
    for e in complete:
        grouped[e['name']] += e['seconds']
        intervals.append((e['start_wall_ns'] / 1e9, e['wall_time_ns'] / 1e9))
    # Use union so overlapping calls cannot yield a negative orchestration residual.
    union, end = 0.0, None
    for a, b in sorted(intervals):
        if b < a:
            raise ValueError('Clock moved backwards during tool call')
        if end is None or a >= end:
            union += b - a
        elif b > end:
            union += b - end
        end = max(end or b, b)
    return {'by_tool_seconds': dict(grouped), 'union_seconds': union, 'calls': len(complete),
            'errors': sum(bool(e.get('error')) for e in complete)}


def stage_docs(destination, mode, runtime=ROOT):
    destination.mkdir(parents=True)
    if mode == 'baseline':
        listing = subprocess.run(['git', 'ls-tree', '-r', '--name-only', BASELINE], cwd=ROOT, check=True,
                                 capture_output=True, encoding='utf-8').stdout.splitlines()
        for rel in listing:
            if rel == 'SKILL.md' or (rel.endswith('.md') and rel.startswith(('references/', 'skills/', 'hooks/'))):
                target = destination / rel; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(subprocess.run(['git', 'show', BASELINE + ':' + rel], cwd=ROOT,
                                                 check=True, capture_output=True).stdout)
    else:
        for source in [runtime / 'SKILL.md', *runtime.glob('references/*.md'), *runtime.glob('skills/**/*.md'), runtime / 'hooks/README.md']:
            target = destination / source.relative_to(runtime); target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
    return {str(p.relative_to(destination)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in destination.rglob('*.md')}


def prompt_for(mode):
    # Both arms use the same complete-delivery budget. A combined bootstrap must not win by
    # accidentally losing half its documents to the outer code-mode tool's default limit.
    delivery = '''For every code-mode exec that returns documents or tool results, put exactly this directive
on its first line: // @exec: {"max_output_tokens": 50000}
Return complete instruction text, not a summary or truncation. If delivery is truncated, recover the
missing content before form actions and do not count it as already read.\n'''
    if mode == 'optimized':
        return delivery + '''Run one COMPLETE explicitly approved synthetic application batch for these same five independent sites:
native-bilingual, search-dropdown, date-cascade, repeated-education, upload-rerender.
Use only formbench MCP tools, no shell, patching, other agents, external websites or JS/internal API mutation.
Discover the available formbench tool names once and reuse them; the catalog does not change during this batch.
Call bootstrap once. Its complete staged Skill/references and approved synthetic profile/batch contract are
already loaded; do not reread them. The same-batch Query, roles/JD/quota, privacy authorization and materials
are confirmed synthetic inputs. Exact-version mock user approval is explicitly simulated by review_submit_batch.
Call prepare_forms with all five sites together: the shipping program handles current DOM observation,
unambiguous semantic mapping, native UI input/readback, upload-first and bounded post-upload rescans.
Only remaining exceptions require your semantic choices and real widget recipes. Use inspect_widgets to
open/advance actual rendered menus, grouping independent sites in the same call. Choose exact visible options,
then call complete_fields with the unresolved recipes grouped across sites. Do not refill verified fields.
Use diagnose_bindings only if real UI exploration or an observed binding failure leaves the binding unknown;
successful ordinary controls need no REA. If diagnosis cannot resolve it, stop that site and report it.
After all forms are ready, call review_submit_batch with the five sites. It serially applies the same real
draft persistence/UI recheck, versioned Review/Submit gates, actual mock UI submission, independent server
receipts and Excel readback. Keep all errors/retries in the measured run; never claim success from a button.
Finally call finish_batch, then give a brief result. All five verified receipts and Excel readbacks are required.
'''
    return delivery + '''Run one COMPLETE model-driven synthetic job application batch using only formbench MCP tools.
This is an explicitly approved benchmark, no live employers. Complete these five independent sites in order:
native-bilingual, search-dropdown, date-cascade, repeated-education, upload-rerender.
First read SKILL.md, batch-contract and synthetic-profile. Read the relevant stage-contract,
browser-application, application-content-fill and privacy-info-fill instructions before acting.
The contract supplies this same-batch mock user's existing Query, role/order/quota and privacy authorization;
review_submit explicitly simulates exact-version mock-user approval. Do not ask duplicate confirmation.
Use real DOM observations, make your own semantic decisions and complex-widget click plans; verify exact
education group and selected option. Do not invent missing facts. Upload approved resume before other
fields on an upload form; rescan after rerender. All actions must use the provided MCP tools. Do not
use shell, patch, external websites, other agents, internal application APIs or JavaScript mutation.
Use read_document for relative Markdown paths; supporting instructions are staged. No source files or
fixture oracle are available. The tool executor uses the shipping Playwright backup input primitives.
After every actual filled form call review_submit. A validation error means correct the form and retry;
every error/retry remains part of measured elapsed time and usage. Do not claim completion before all
five server receipts and Excel readbacks are verified. Finally call finish_batch and give a brief result.
''' + ('''Enhanced mode: also read references/semantic-form-automation.md. Use auto_fill for unambiguous
fields. Actually call rea_inspect on search-dropdown, date-cascade and upload-rerender, and reason from
its captured frontend script Evidence to choose real clicks and handle rerender. REA itself does not
call a model; your interpretation and subsequent calls are included in the actual model usage.
''' if mode == 'enhanced' else '''Baseline mode: deterministic semantic mapper and REA are unavailable.
Use the full live inventory, select every profile source yourself, and discover real custom widget
options using inspect_ui. configure_fill batches fields and executes your explicitly supplied click
paths. Keep decisions compact; all ordinary fields still require your source choice.
''')


def runtime_environment(args):
    return {'python': platform.python_version(), 'os': platform.system(),
            'node': subprocess.check_output(['node', '--version'], text=True).strip(),
            'codex_cli': subprocess.check_output(['node', str(args.codex_entry), '--version'], text=True).strip(),
            'rea': json.loads((args.rea_entry.parent.parent / 'package.json').read_bytes())['version'],
            'playwright_python': importlib.metadata.version('playwright'),
            'matplotlib': importlib.metadata.version('matplotlib'), 'model': args.model, 'reasoning_effort': 'high',
            'model_network_orchestration_is_not_pure_reasoning_time': True,
            'draft_readback': 'server GET plus current UI field recheck; browser reopening/restoration not measured',
            'scope': 'confirmed-role synthetic application cycle; development/CI and real human/login waiting excluded'}


def command_for(args, mode, root, docs, cwd, controller_entry=None, controller_extra=None):
    cmd = ['node', str(args.codex_entry), 'exec', '--json', '--ignore-user-config', '--skip-git-repo-check',
           '--color', 'never', '-C', str(cwd), '-s', 'read-only', '-m', args.model,
           '-c', 'model_reasoning_effort="high"', '-c', 'web_search="disabled"',
           '-c', 'tool_output_token_limit=50000',
           '-c', 'mcp_servers.formbench.command=' + json.dumps(sys.executable),
           '-c', 'mcp_servers.formbench.args=' + json.dumps([str(controller_entry or HERE / 'full_chain_mcp.py'), '--mode', mode,
                     '--root', str(root), '--docs', str(docs), '--rea-entry', str(args.rea_entry), *(controller_extra or [])]),
           '-c', 'mcp_servers.formbench.tool_timeout_sec=240', '-c', 'mcp_servers.formbench.startup_timeout_sec=30']
    # This one synthetic, owned server is explicitly authorized for the benchmark. Do not change
    # any global approval policy or permissions for other servers/apps.
    cmd += ['-c', 'mcp_servers.formbench.default_tools_approval_mode="approve"']
    for tool in ('bootstrap', 'read_document', 'read_reference'):
        cmd += ['-c', 'mcp_servers.formbench.tools.' + tool + '.output_token_limit=50000']
    cmd += ['-c', 'mcp_servers.formbench.env.PYTHONIOENCODING="utf-8"',
            '-c', 'mcp_servers.formbench.env.PYTHONUNBUFFERED="1"']
    for feature in ('shell_tool', 'multi_agent', 'plugins', 'apps', 'browser_use', 'computer_use',
                    'in_app_browser', 'hooks', 'skill_search', 'image_generation', 'view_image'):
        cmd += ['--disable', feature]
    cmd += ['--enable', 'skip_host_skill_discovery', '-']
    return cmd


def stage_runtime(destination, ref=None):
    destination.mkdir(parents=True)
    if ref:
        archived = subprocess.run(['git', 'archive', '--format=zip', ref], cwd=ROOT, check=True, capture_output=True).stdout
        with zipfile.ZipFile(io.BytesIO(archived)) as z:
            for name in z.namelist():
                if not (destination / name).resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Archive path escapes the owned snapshot')
            z.extractall(destination)
    else:
        for name in ('scripts', 'hooks', 'references', 'skills'):
            shutil.copytree(ROOT / name, destination / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        shutil.copyfile(ROOT / 'SKILL.md', destination / 'SKILL.md')
    return destination


def run_round(args, mode, private, runtime=ROOT, context=None):
    work = private / mode; work.mkdir(parents=True)
    docs, runroot, cwd = work / 'docs', work / 'controller', work / 'cwd'
    cwd.mkdir()
    hashes = stage_docs(docs, mode, runtime)
    context = context or {}
    cmd = command_for(args, mode, runroot, docs, cwd, context.get('controller_entry', runtime / 'scripts/full_chain_mcp.py'), context.get('controller_extra'))
    prompt = context.get('prompt', prompt_for(mode))
    (work / 'prompt.txt').write_text(prompt, encoding='utf-8')
    t0, mono0 = time.time_ns(), time.perf_counter()
    env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
    eventpath = work / 'cli-events.jsonl'
    lines = queue.Queue()
    with (work / 'stderr.log').open('w', encoding='utf-8') as stderr:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
                                cwd=cwd, text=True, encoding='utf-8', errors='replace', env=env)
        proc.stdin.write(prompt); proc.stdin.close()
        def collect():
            for line in proc.stdout:
                lines.put(line)
            lines.put(None)
        thread = threading.Thread(target=collect, daemon=True); thread.start()
        timeout, ended = False, False
        with eventpath.open('w', encoding='utf-8', newline='\n') as out:
            while not ended:
                if time.perf_counter() - mono0 > args.timeout:
                    timeout = True
                    # Windows taskkill only this owned process tree; no files or global config changed.
                    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True) if os.name == 'nt' else proc.kill()
                    break
                try:
                    line = lines.get(timeout=1)
                except queue.Empty:
                    continue
                if line is None:
                    ended = True; break
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                event['_received_wall_ns'] = time.time_ns()
                out.write(json.dumps(event, ensure_ascii=False) + '\n'); out.flush()
                if event.get('type') in ('thread.started', 'turn.completed', 'turn.failed', 'error'):
                    print(mode + ': ' + json.dumps(event, ensure_ascii=False)[:1500], flush=True)
                elif event.get('type') == 'item.completed':
                    item = event.get('item', {})
                    print(mode + ': item ' + item.get('type', '') + ' ' + str(item.get('tool', item.get('text', '')))[:240], flush=True)
        rc = proc.wait(timeout=30)
    wall_seconds = time.perf_counter() - mono0
    events = read_jsonl(eventpath)
    thread_id = next((e['thread_id'] for e in events if e.get('type') == 'thread.started'), None)
    usage = usage_from_events(events)
    rollout, selected, truncations = None, None, []
    if thread_id:
        sessions = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions'
        matches = list(sessions.glob('**/rollout-*-' + thread_id + '.jsonl'))
        if len(matches) == 1:
            selected = matches[0]; rollout = rollout_usage(selected)
            truncations = truncated_outputs(read_jsonl(selected))
    verified = json.loads((runroot / 'verified-batch.json').read_bytes()) if (runroot / 'verified-batch.json').is_file() else None
    tools = read_jsonl(runroot / 'tool-events.jsonl'); phases = tool_time(tools)
    batch_end = next((e['wall_time_ns'] for e in tools if e.get('kind') == 'batch_verified'), None)
    if usage and rollout and rollout['usage']:
        for key in ('input_tokens', 'cached_input_tokens', 'output_tokens'):
            if usage[key] != rollout['usage'][key]:
                raise ValueError('CLI/rollout aggregate mismatch: ' + key)
        for key in ('reasoning_output_tokens', 'cache_write_input_tokens'):
            if usage[key] is None:
                usage[key] = rollout['usage'][key]
    elif not usage and rollout:
        usage = rollout['usage']  # failed paid turn: retain every reported partial token
    result = {'mode': mode, 'model': args.model, 'reasoning_effort': 'high', 'thread_id': thread_id,
              'started_utc': datetime.datetime.fromtimestamp(t0 / 1e9, datetime.timezone.utc).isoformat(),
              'wall_seconds': wall_seconds, 'to_batch_verified_seconds': (batch_end - t0) / 1e9 if batch_end else None,
              'exit_code': rc, 'timed_out': timeout, 'completed': rc == 0 and bool(verified),
              'usage': usage, 'usage_source': 'Codex turn.completed + selected rollout token_count' if rollout else 'Codex turn.completed',
              'request_usage': rollout['requests'] if rollout else [], 'request_count': rollout['request_count'] if rollout else None,
              'tool_timing': phases, 'model_network_orchestration_seconds': max(0, wall_seconds - phases['union_seconds']),
              'verified_batch': verified, 'skill_sha256': hashes,
              'runtime_sha256': {p.relative_to(runtime).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for d in ('scripts', 'hooks') for p in (runtime / d).rglob('*')
                                 if p.is_file() and p.suffix in ('.py', '.cjs', '.js') and '__pycache__' not in p.parts},
              'rea_cli_seconds': sum(phases['by_tool_seconds'].get(k, 0) for k in ('rea_inspect', 'diagnose_bindings')),
              'error_events': sum(e.get('type') in ('error', 'turn.failed') for e in events)}
    result['truncated_outputs'] = truncations
    result['complete_delivery_valid'] = selected is not None and not truncations
    if context.get('site'):
        result.update(site=context['site'], cache_state=context['cache_state'])
        seed = (verified or {}).get('isolated_case', {}).get('cache', {})
        result['cache_seed_seconds'] = seed.get('seconds')
        result['wall_excluding_seed_seconds'] = wall_seconds - seed['seconds'] if seed.get('seconds') is not None else None
    if verified:
        from full_chain_progress import receipt_progress
        result['site_progress'] = receipt_progress(result, tools, [context['site']] if context.get('site') else None)
    (work / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--model', default='gpt-5.6-sol')
    p.add_argument('--rea-entry', type=Path, default=DEFAULT_REA)
    p.add_argument('--codex-entry', type=Path, default=DEFAULT_CODEX)
    p.add_argument('--timeout', type=int, default=1800)
    p.add_argument('--comparison', choices=list(COMPARISONS), default='baseline-enhanced')
    p.add_argument('--before-ref', default=OPTIMIZATION_BEFORE, help='Frozen pre-optimization controller and Skill revision')
    args = p.parse_args()
    for entry in (args.rea_entry, args.codex_entry):
        if not entry.is_file():
            p.error('Missing installed entry point: ' + str(entry))
    args.private = args.private.resolve(); args.report = args.report.resolve()
    args.private.mkdir(parents=True, exist_ok=True); args.report.mkdir(parents=True, exist_ok=True)
    (args.report / 'environment.json').write_text(json.dumps(runtime_environment(args), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    results = []
    modes = COMPARISONS[args.comparison]
    runtimes = {m: ROOT for m in modes}
    if args.comparison in ('optimization', 'baseline-optimized'):
        # Baseline uses the same pre-optimization executor, with mapper/REA tools disabled;
        # stage_docs separately freezes its original pre-REA Skill at BASELINE.
        runtimes[modes[0]] = stage_runtime(args.private / 'runtime-before', args.before_ref)
        runtimes['optimized'] = stage_runtime(args.private / 'runtime-optimized')
    for mode in modes:
        results.append(run_round(args, mode, args.private, runtimes[mode]))
        report = {'protocol_version': 2, 'comparison': args.comparison, 'baseline_commit': BASELINE,
                  'before_commit': args.before_ref if args.comparison in ('optimization', 'baseline-optimized') else None,
                  'instruction_delivery': 'Same 50000-token history/MCP/code-mode output budget in both arms; zero truncation required',
                  'site_progress_boundary': 'Cumulative from batch CLI start, not independent site cost or allocated tokens',
                  'isolated_cold_warm_full_chain_measured': False,
                  'scope': 'one real model-driven fresh-context batch per mode, five owned mock forms each',
                  'lane': 'shipping Playwright backup executor + real Codex CLI + actual REA CLI in enhanced',
                  'timing_boundary': 'CLI process start through complete agent turn/process exit; batch verified boundary separately recorded',
                  'preseeded': 'synthetic confirmed role/JD list, Query/quota facts and approvals; mock-user review simulated',
                  'human_wait_measured': False, 'paid_api_or_account_credits': 'current saved ChatGPT Codex login',
                  'rea_token_attribution': 'REA has no LLM usage; model evidence interpretation is included in aggregate input/output. No unsupported module token split.',
                  'results': results}
        (args.report / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if not results[-1]['completed'] and results[-1]['tool_timing']['calls'] == 0:
            print('Stopping: no controller tools executed; resolve startup/policy before spending another model turn.', flush=True)
            break
    return 0 if len(results) == 2 and all(r['completed'] and r['complete_delivery_valid'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
