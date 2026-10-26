"""Allow only typed public V2 configuration JSON; never private profiles, runs or company assets.

公司目录与各公司登录/表单配置属于工作区内容（岗位交接/公司/），不随组件包发布；
组件包只带通用配置（入口配方）和测试夹具。
"""
import json
import hashlib
import re
from datetime import datetime
from pathlib import Path

LOGIN_KEYS = {'schemaVersion', 'companyId', 'version', 'origin', 'loginPath', 'allowedPaths', 'evidence', 'account', 'fields', 'popups', 'consent', 'methods', 'challenge', 'success'}
LOGIN_FIELDS = {'root', 'country', 'countrySelected', 'countryOptionLabel', 'phone', 'otp', 'send', 'sendLabel', 'submit', 'submitLabel', 'consent', 'consentPresence', 'errors', 'automaticRegistrationNotice'}


def no_personal_data(content):
    assert not re.search(r'(?<!\d)1[3-9]\d{9}(?!\d)', content), 'personal phone in public asset'
    assert not re.search(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', content), 'personal email in public asset'
    assert '/Users/' not in content and '/Volumes/' not in content


def closed_object(value, required, optional=()):
    assert isinstance(value, dict), 'public asset must contain objects'
    assert set(required) <= set(value) <= set(required) | set(optional), 'unknown or missing public asset fields'


def validate_role_materials(value):
    closed_object(value, {'schemaVersion', 'materials'}, {'说明'})
    assert type(value['schemaVersion']) is int and value['schemaVersion'] == 1
    assert isinstance(value['materials'], list) and value['materials']
    if '说明' in value:
        assert isinstance(value['说明'], str)
    keys, sources = set(), set()
    for material in value['materials']:
        closed_object(material, {'key', 'source', 'labels', 'value', 'requiredInInventory'})
        key = material['key']
        assert isinstance(key, str) and re.fullmatch(r'[a-z][A-Za-z0-9_]{0,63}', key)
        assert material['source'] == 'material:' + key
        assert key not in keys and material['source'] not in sources, 'duplicate role material'
        keys.add(key); sources.add(material['source'])
        labels = material['labels']
        assert isinstance(labels, list) and labels and all(isinstance(label, str) and 0 < len(label) <= 100 for label in labels)
        assert len(set(labels)) == len(labels)
        assert type(material['requiredInInventory']) is bool
        pattern = material['value']
        assert isinstance(pattern, str) and len(pattern) <= 500 and pattern.startswith('^') and pattern.endswith('$'), 'material value must be a format pattern, never an answer'
        try:
            re.compile(pattern)
        except re.error as error:
            raise AssertionError('invalid material format pattern') from error
    content = json.dumps(value, ensure_ascii=False)
    assert not re.search(r'https?://', content), 'role materials must be domain independent'
    no_personal_data(content)


def generated_class(token):
    match = re.search(r'(?:^|__)sc-([A-Za-z0-9]{5,10})(?:-\d+)?$', token)
    if match and re.search(r'\d|[a-z][A-Z]|[A-Z][a-z][A-Z]', match[1]):
        return True
    if re.search(r'___[A-Za-z0-9_-]{5}$', token):
        return True
    match = re.match(r'css-([a-z0-9]{5,})(?:-|$)', token)
    return bool(match and re.search(r'\d', match[1]))


def validate_learned_targets(value):
    closed_object(value, {'revision', 'targets'})
    assert type(value['revision']) is int and value['revision'] == 1
    assert isinstance(value['targets'], list)
    seen = set()
    step = r'[a-z][a-z0-9-]*(?:\.[A-Za-z_][\w-]*)*'
    for target in value['targets']:
        closed_object(target, {'id', 'driver', 'selector', 'evidence', 'approval'})
        driver, selector = target['driver'], target['selector']
        assert driver in {'phoenix_list_popup.selection', 'phoenix_area.selection'}
        assert isinstance(selector, str) and len(selector) <= 300
        assert re.fullmatch(r':scope\s*>\s*' + step + r'(?:\s*>\s*' + step + r')*', selector, re.ASCII), 'learned targets must stay inside their row'
        assert not any(generated_class(token) for token in re.findall(r'\.([A-Za-z_][\w-]*)', selector, re.ASCII)), 'generated class in learned target'
        expected_id = 'lt-' + hashlib.sha256((driver + '\n' + selector).encode()).hexdigest()[:12]
        assert target['id'] == expected_id and expected_id not in seen, 'incorrect or duplicate learned target id'
        seen.add(expected_id)
        evidence, approval = target['evidence'], target['approval']
        closed_object(evidence, {'runId', 'companyId'})
        assert isinstance(evidence['runId'], str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}', evidence['runId'])
        assert isinstance(evidence['companyId'], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,60}', evidence['companyId'])
        closed_object(approval, {'at', 'quoteSha256'})
        assert isinstance(approval['at'], str)
        try:
            approved_at = datetime.fromisoformat(approval['at'].replace('Z', '+00:00'))
        except ValueError as error:
            raise AssertionError('invalid approval timestamp') from error
        assert approved_at.tzinfo is not None, 'approval timestamp must include its timezone'
        assert isinstance(approval['quoteSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', approval['quoteSha256'])
        # Hash fields have their own closed syntax: scanning their digit runs
        # as phone numbers would reject legitimate hashes. No raw quote ships.
        no_personal_data(json.dumps({'driver': driver, 'selector': selector, 'evidence': evidence}))


def public_json_files(root):
    root = Path(root)
    allowed = {'package.json', 'package-lock.json', 'catalog/entry-recipes.json', 'catalog/workflow-tools.json'}
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    assert set(package) <= {'name', 'version', 'private', 'type', 'files', 'scripts', 'dependencies'}
    assert package['name'] == 'job-application-suite-v2' and package['private'] is True
    assert 'companies/' not in package.get('files', []), 'company assets must not ship in the package'
    lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
    assert lock['name'] == package['name'] and lock['version'] == package['version']
    recipes = json.loads((root / 'catalog/entry-recipes.json').read_text(encoding='utf-8'))
    assert set(recipes) == {'schemaVersion', 'readyTimeoutMs', 'recipes'} and recipes['schemaVersion'] == 1
    for name, recipe in recipes['recipes'].items():
        assert re.fullmatch(r'[a-z0-9_]+', name)
        text = json.dumps(recipe, ensure_ascii=False)
        assert not re.search(r'https?://', text), 'entry recipes must not hardcode domains'
    no_personal_data(json.dumps(recipes, ensure_ascii=False))
    lifecycle = json.loads((root / 'catalog/workflow-tools.json').read_text(encoding='utf-8'))
    assert set(lifecycle) == {'revision', 'inspections', 'stages'} and lifecycle['revision'] == 1
    assert isinstance(lifecycle['inspections'], list) and isinstance(lifecycle['stages'], dict)
    names = lifecycle['inspections'] + list(lifecycle['stages'])
    assert len(names) == len(set(names)) and all(re.fullmatch(r'[a-z_]+', n) for n in names)
    for phase, tools in lifecycle['stages'].values():
        assert phase in {'construct', 'map', 'prepare', 'verify', 'route', 'login', 'closed', 'closeout', 'technical_block', 'submit'}
        assert isinstance(tools, list) and all(t in names for t in tools)
    no_personal_data(json.dumps(lifecycle))
    for name, validate in [('role-materials.json', validate_role_materials),
                           ('learned-targets.json', validate_learned_targets)]:
        relative = 'catalog/' + name
        validate(json.loads((root / relative).read_text(encoding='utf-8')))
        allowed.add(relative)
    assert not (root / 'catalog/companies.json').exists(), 'company catalog lives in the workspace, not the package'
    for file in (root / 'test/fixtures').glob('*.login.json'):
        c = json.loads(file.read_text(encoding='utf-8'))
        assert set(c) <= LOGIN_KEYS | {'entry'} and LOGIN_KEYS <= set(c)
        assert file.name == c['companyId'] + '.login.json'
        assert c['schemaVersion'] == 1 and set(c['fields']) == LOGIN_FIELDS
        assert set(c['account']) == {'selector', 'source', 'countryCode', 'mask'}
        assert c['account']['mask'] == 'first4_last3'
        assert all(isinstance(value, str) for value in c['fields'].values())
        no_personal_data(json.dumps(c, ensure_ascii=False))
        allowed.add(file.relative_to(root).as_posix())
    for file in root.rglob('*.json'):
        relative = file.relative_to(root)
        if {'node_modules', '.git', '__pycache__'}.intersection(relative.parts):
            continue
        assert relative.as_posix() in allowed, 'private or unknown JSON in V2 package: ' + relative.as_posix()
    return allowed


if __name__ == '__main__':
    import sys
    print(json.dumps({'public_json': sorted(public_json_files(sys.argv[1]))}))
