#!/usr/bin/env python3
"""Compile browser-neutral semantic mappings into the existing, validated fill-plan contract.

No profile values, role state, approval, save clicks or submission are created here.
Complex controls remain pending until an Agent supplies and verifies their real click recipe.
"""
import argparse
import json
import sys
from pathlib import Path
import fill_plan


def compile_plan(inventory, mapping, batch, company, url, lane):
    if not isinstance(mapping, dict) or not isinstance(inventory, dict) or mapping.get('version') != 1:
        raise ValueError('Unsupported mapping version')
    # Recompute with the owning JS mapper so edited/stale maps cannot silently become executable.
    import subprocess
    script = Path(__file__).with_name('verify_form_mapping.cjs')
    result = subprocess.run(['node', str(script)], input=json.dumps({'inventory': inventory, 'mapping': mapping, 'url': url}),
                            capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise ValueError('Mapping is stale or edited: ' + result.stderr.strip())
    plan = fill_plan.from_inventory(inventory, batch, company, url, lane)
    by_locator = {json.dumps(f['locator'], sort_keys=True, ensure_ascii=False): f for f in mapping['fields']}
    for field in plan['字段']:
        match = by_locator.get(json.dumps(field['定位'], sort_keys=True, ensure_ascii=False))
        if not match:
            # Repeated labels must use current scoped CSS rather than a broad label lookup.
            candidates = [f for f in mapping['fields'] if f['label'] == field['标签']]
            if len(candidates) == 1:
                match = candidates[0]
        if match:
            field['定位'] = match['locator']
            if match['source']:
                field['值来源'] = match['source']
            if match['disposition'] == 'exception':
                field.update({'填法': '用户', '状态': '需用户', '备注': match['reason']})
                field.pop('点击步骤', None)
            elif not match['source']:
                field.update({'填法': '用户', '状态': '需用户'})
        else:
            field.update({'填法': '用户', '状态': '需用户', '备注': 'Missing unambiguous semantic mapping'})
    errors = fill_plan.validate(plan)
    if errors:
        raise ValueError('\n'.join(errors))
    return plan


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('inventory'); p.add_argument('mapping')
    for flag in ('batch', 'company', 'url', 'out'):
        p.add_argument('--' + flag, required=True)
    p.add_argument('--lane', choices=fill_plan.LANES, required=True)
    p.add_argument('--workbook')
    args = p.parse_args()
    try:
        plan = compile_plan(fill_plan.load(args.inventory), fill_plan.load(args.mapping), args.batch, args.company, args.url, args.lane)
        if args.workbook:
            errors = fill_plan.bind(plan, args.workbook)
            if errors:
                raise ValueError('\n'.join(errors))
        fill_plan.save(args.out, plan)
        print(json.dumps({'fields': len(plan['字段']), 'pending': sum(f['状态'] == '需用户' for f in plan['字段'])}))
        return 0
    except (ValueError, OSError, KeyError) as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
