"""Compile a verified REA rule to existing fill-plan/actions for any current browser lane.

No browser launch, input, save, approval or submission. Current inventory, mapping
and authorized profile are private inputs. Output is a fresh pending plan, never a
completed plan or a new authorization. Promotion still requires actual adapter checks.
"""
import argparse
import json
import sys
from pathlib import Path
import fill_plan
from compile_form_mapping import compile_plan
from rea_rule_store import RuleStore, form_scope, resolve_recipe, identities, digest


def compile_rule(rule, inventory, mapping, profile, batch, company, url, lane):
    unsigned = {k: v for k, v in rule.items() if k != 'integrity_sha256'}
    if rule.get('integrity_sha256') != digest(unsigned) or rule.get('version') != 1 or rule.get('state') != 'verified' or rule.get('scope') != form_scope(url):
        raise ValueError('A verified intact rule for this exact current form is required')
    if rule['structure'] != identities(inventory, mapping):
        raise ValueError('Current structure differs from learned rule')
    if len(rule['recipes']) != len(mapping['fields']) or rule['structure_sha256'] != digest(rule['structure']):
        raise ValueError('Incomplete or changed rule assignments')
    # Owning mapper recomputes all current semantic assignments before compilation.
    plan = compile_plan(inventory, mapping, batch, company, url, lane)
    for mapped, recipe in zip(mapping['fields'], rule['recipes']):
        current, = [c for c in inventory['fields'] if c['index'] == mapped['index']]
        field, = [f for f in plan['字段'] if f['标签'] == mapped['label'] and f.get('值来源') == mapped['source']]
        spec = resolve_recipe(recipe, current, profile)
        if recipe['source'] != mapped['semantic']:
            raise ValueError('Recipe source does not match current field')
        field.update(状态='待填', 读回='', 更新时间='', 备注='Verified rule; current input/readback and existing gates still required')
        if spec.get('clicks'):
            field.update(填法='点击', 点击步骤=[{'点击': loc} for loc in spec['clicks']], 读回定位=spec['readback'])
        elif mapped['disposition'] != 'automatic':
            raise ValueError('Complex field has no reusable click path')
    errors = fill_plan.validate(plan, ready=True)
    if errors:
        raise ValueError('\n'.join(errors))
    return plan


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('inventory', 'mapping', 'profile', 'rules', 'batch', 'company', 'url', 'out'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--lane', required=True, choices=fill_plan.LANES)
    args = p.parse_args()
    try:
        inventory, mapping, profile = [json.loads(Path(v).read_bytes()) for v in (args.inventory, args.mapping, args.profile)]
        rule = RuleStore(args.rules).load(form_scope(args.url), inventory, mapping)
        if rule is None:
            raise ValueError('No verified rule for this current form; continue normal UI preparation')
        plan = compile_rule(rule, inventory, mapping, profile, args.batch, args.company, args.url, args.lane)
        fill_plan.save(args.out, plan)
        print(json.dumps({'fields': len(plan['字段']), 'lane': args.lane, 'all_pending': True,
                          'rule_sha256': rule['integrity_sha256']}))
        return 0
    except (ValueError, KeyError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
