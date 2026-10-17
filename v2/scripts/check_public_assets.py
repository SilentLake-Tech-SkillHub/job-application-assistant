"""Allow only typed public V2 configuration JSON; never private profiles or runs."""
import json
import re
from pathlib import Path


def public_json_files(root):
    root = Path(root)
    allowed = {'package.json', 'package-lock.json', 'catalog/companies.json'}
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    assert set(package) <= {'name', 'version', 'private', 'type', 'files', 'scripts', 'dependencies'}
    assert package['name'] == 'job-application-suite-v2' and package['private'] is True
    lock = json.loads((root / 'package-lock.json').read_text(encoding='utf-8'))
    assert lock['name'] == package['name'] and lock['version'] == package['version']
    catalog = json.loads((root / 'catalog/companies.json').read_text(encoding='utf-8'))
    assert set(catalog) == {'schemaVersion', 'companies'} and catalog['schemaVersion'] == 1
    ids = set()
    for company in catalog['companies']:
        assert set(company) == {'id', 'name', 'origin', 'channel', 'templateId'}
        assert re.fullmatch(r'[a-z0-9_-]+', company['id'])
        assert re.fullmatch(r'https://[a-zA-Z0-9.-]+', company['origin'])
        assert company['id'] not in ids
        ids.add(company['id'])
    fields = {'root', 'country', 'countrySelected', 'countryOptionLabel', 'phone', 'otp', 'send', 'sendLabel', 'submit', 'submitLabel', 'consent', 'consentPresence', 'errors', 'automaticRegistrationNotice'}
    for file in (root / 'companies').glob('*.login.json'):
        c = json.loads(file.read_text(encoding='utf-8'))
        assert set(c) == {'schemaVersion', 'companyId', 'version', 'origin', 'loginPath', 'allowedPaths', 'evidence', 'account', 'fields', 'popups', 'consent', 'methods', 'challenge', 'success'}
        assert c['companyId'] in ids and file.name == c['companyId'] + '.login.json'
        assert c['schemaVersion'] == 1 and set(c['fields']) == fields
        assert set(c['account']) == {'selector', 'source', 'countryCode', 'mask'}
        assert c['account']['mask'] == 'first4_last3'
        assert all(isinstance(value, str) for value in c['fields'].values())
        assert c['origin'] == next(x['origin'] for x in catalog['companies'] if x['id'] == c['companyId'])
        content = json.dumps(c, ensure_ascii=False)
        assert not re.search(r'(?<!\d)1[3-9]\d{9}(?!\d)', content), 'personal phone in public asset'
        assert not re.search(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', content), 'personal email in public asset'
        assert '/Users/' not in content and '/Volumes/' not in content
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
