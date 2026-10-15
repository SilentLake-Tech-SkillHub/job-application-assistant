"""Value-free REA rule lifecycle. Browser adapters supply actual input/readback callbacks.

This module never saves a draft, approves or submits. A rule hit is a preparation hint,
not proof of current input, authorization or backend binding. No executable code is stored.
"""
import copy
import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

VERSION = 1


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def form_scope(url):
    u = urlsplit(url)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        raise ValueError('Expected current credential-free HTTP(S) form URL')
    return u.scheme + '://' + u.netloc.lower() + u.path


def identities(inventory, mapping):
    if inventory.get('readOnly') is not True or inventory.get('valuesIncluded') is not False:
        raise ValueError('Rules require current value-free read-only inventory')
    if inventory.get('count') != len(inventory['fields']) or not 0 < len(mapping['fields']) <= 2000:
        raise ValueError('Incomplete inventory or mapping')
    result = []
    for f in mapping['fields']:
        c, = [c for c in inventory['fields'] if c['index'] == f['index']]
        if not f.get('source') or not f.get('semantic') or c.get('fieldIdentityNeedsReview') or c.get('disabled'):
            raise ValueError('Ambiguous, disabled or unknown-source fields cannot be learned')
        result.append({k: f.get(k) for k in ('label', 'group', 'kind', 'semantic', 'source')} | {
            k: c.get(k) for k in ('required', 'readonly', 'multiple', 'maxLength', 'accept')} | {
            'native_options': c.get('optionLabels', []) if 'select' in c.get('evidence', []) else []})
    if len({digest(x) for x in result}) != len(result):
        raise ValueError('Field identities must be unique')
    return result


def validate_selector(selector, sources):
    if selector in ({'target': 'wrapper'}, {'target': 'control'}):
        return
    if set(selector) != {'role', 'name'} or selector['role'] not in ('option', 'button', 'treeitem', 'gridcell', 'radio'):
        raise ValueError('Only current controls and exact named UI options can be stored')
    name = selector['name']
    if isinstance(name, dict):
        if set(name) != {'value_source'} or name['value_source'] not in sources:
            raise ValueError('Unknown dynamic option source')
    elif not isinstance(name, str) or not name or len(name) > 200:
        raise ValueError('Invalid fixed option name')
    elif any(s in name.lower() for s in ('提交', '保存', '申请', 'submit', 'save', 'apply', '同意', 'consent')):
        raise ValueError('Approval, draft and submission actions cannot be cached as field steps')


def validate_recipe(recipe, sources):
    if set(recipe) != {'source', 'steps', 'readback'} or recipe['source'] not in sources:
        raise ValueError('Invalid recipe source/schema')
    if recipe['readback'] != 'current-control' or not isinstance(recipe['steps'], list) or len(recipe['steps']) > 12:
        raise ValueError('Recipe needs bounded steps and a current scalar readback')
    for step in recipe['steps']:
        validate_selector(step, sources)


def resolve_recipe(recipe, control, profile):
    """Compile with current inventory locators and current authorized source values only."""
    validate_recipe(recipe, set(profile) | {'resume'})
    clicks = []
    for step in recipe['steps']:
        if 'target' in step:
            css = control.get('controlLocator') if step['target'] == 'control' else control.get('locator')
            if not css:
                raise ValueError('Current control locator missing')
            clicks.append({'css': css})
        else:
            name = step['name']
            name = profile[name['value_source']] if isinstance(name, dict) else name
            clicks.append({'role': step['role'], 'name': str(name), 'exact': True})
    spec = {'index': control['index'], 'source': recipe['source']}
    if clicks:
        spec.update(clicks=clicks, readback={'css': control.get('controlLocator') or control['locator']})
    return spec


class RuleStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    def path(self, scope):
        return self.directory / (digest(scope) + '.json')

    def candidate(self, scope, inventory, mapping, recipes, evidence):
        fields = identities(inventory, mapping)
        if len(recipes) != len(fields):
            raise ValueError('Every field requires a verified recipe')
        if not evidence.get('sha256') or len(evidence['sha256']) != 64 or evidence.get('truncated') is not False:
            raise ValueError('Complete actual REA evidence required')
        sources = {r['source'] for r in recipes}
        for f, r in zip(fields, recipes):
            validate_recipe(r, sources)
            expected = 'resume' if f['semantic'] == 'resume' else f['semantic']
            if r['source'] != expected:
                raise ValueError('Recipe differs from current semantic source')
        return {'version': VERSION, 'state': 'candidate', 'scope': scope,
                'structure': fields, 'structure_sha256': digest(fields), 'recipes': copy.deepcopy(recipes),
                'evidence': copy.deepcopy(evidence)}

    def promote(self, candidate, verify):
        """verify must actually recheck all current fields AND the persisted server draft."""
        if candidate.get('state') != 'candidate':
            raise ValueError('Only candidates may be promoted')
        verification = verify()
        if verification.get('current_readbacks') != len(candidate['structure']) or verification.get('server_draft_matched') is not True:
            raise ValueError('Current readback and server draft verification required')
        value = copy.deepcopy(candidate)
        value.update(state='verified', verified_at=time.time(), validation={
            'field_count': verification['current_readbacks'], 'server_draft_matched': True})
        value['integrity_sha256'] = digest(value)
        path = self.path(value['scope'])
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, path)
        return value

    def load(self, scope, inventory, mapping):
        path = self.path(scope)
        if not path.is_file():
            return None
        try:
            if path.stat().st_size > 1024 * 1024:
                raise ValueError('Oversized rule')
            rule = json.loads(path.read_bytes())
            integrity = rule.pop('integrity_sha256')
            if digest(rule) != integrity or rule['version'] != VERSION or rule['state'] != 'verified' or rule['scope'] != scope:
                raise ValueError('Rule integrity/state/scope mismatch')
            fields = identities(inventory, mapping)
            if fields != rule['structure'] or digest(fields) != rule['structure_sha256']:
                raise ValueError('Current structure changed')
            # Revalidate schema and source assignments even for a digest-consistent edited file.
            self.candidate(scope, inventory, mapping, rule['recipes'], rule['evidence'])
            rule['integrity_sha256'] = integrity
            return rule
        except (ValueError, TypeError, KeyError):
            self.invalidate(scope, 'integrity, schema or current structure mismatch')
            return None

    def invalidate(self, scope, reason):
        path = self.path(scope)
        if path.exists():
            # Keep failed artifacts for audit; never silently delete/reuse a rejected rule.
            archive = path.with_suffix('.invalid-' + str(time.time_ns()) + '.json')
            os.replace(path, archive)
            archive.with_suffix('.reason.txt').write_text(reason, encoding='utf-8')
