"""Allow only typed public V2 configuration JSON; never private profiles, runs or company assets.

公司目录与各公司登录/表单配置属于工作区内容（岗位交接/公司/），不随组件包发布；
组件包只带通用配置（入口配方）和测试夹具。
"""
import json
import re
from pathlib import Path

LOGIN_KEYS = {'schemaVersion', 'companyId', 'version', 'origin', 'loginPath', 'allowedPaths', 'evidence', 'account', 'fields', 'popups', 'consent', 'methods', 'challenge', 'success'}
LOGIN_FIELDS = {'root', 'country', 'countrySelected', 'countryOptionLabel', 'phone', 'otp', 'send', 'sendLabel', 'submit', 'submitLabel', 'consent', 'consentPresence', 'errors', 'automaticRegistrationNotice'}


def no_personal_data(content):
    assert not re.search(r'(?<!\d)1[3-9]\d{9}(?!\d)', content), 'personal phone in public asset'
    assert not re.search(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', content), 'personal email in public asset'
    assert '/Users/' not in content and '/Volumes/' not in content


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
