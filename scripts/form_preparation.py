"""Browser-neutral automatic preparation loop; adapters own real input and readback.

No widget recipes, fixture answers, approvals, saves or submission live here. A capture returns
current DOM inventory and a validated mapping. Only automatic fields with explicit source references
are executed. Upload/rerender invalidation is resolved inside the bounded program loop.
"""


def prepare_automatic(capture, verified, apply, max_passes=3):
    if not 1 <= max_passes <= 10:
        raise ValueError('Preparation needs a bounded rescan budget')
    readbacks, skipped = [], []
    for generation in range(max_passes):
        mapping = capture()
        if not mapping.get('fields'):
            raise ValueError('No rendered fields; inspect the current page instead of claiming preparation complete')
        work = []
        for field in mapping['fields']:
            if field['disposition'] != 'automatic':
                continue
            if not field.get('source') or not field['source'].startswith(('档案:', '材料:')):
                raise ValueError('Automatic fields require an approved source reference')
            if verified(field):  # adapter must check current UI, not just a cached status
                skipped.append(field['index'])
            else:
                work.append(field)
        work.sort(key=lambda f: 0 if f['semantic'] == 'resume' else 1)
        result = apply(work) if work else {'readbacks': [], 'requires_rescan': False}
        readbacks.extend(result['readbacks'])
        if not result.get('requires_rescan'):
            return {'readbacks': readbacks, 'skipped_current_readbacks': skipped,
                    'passes': generation + 1, 'mapping': mapping}
    raise ValueError('DOM kept invalidating; stop preparation and inspect the current page')


class DocumentBundle:
    """Return a staged document once per batch; subsequent access is a hash acknowledgment.

The original text is still in the model's context. A changed source hash invalidates this cache.
"""
    def __init__(self, read):
        self.read = read
        self.loaded = {}

    def get(self, path):
        import hashlib
        import json
        value = self.read(path)
        digest = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        if self.loaded.get(path) == digest:
            return {'path': path, 'already_loaded': True, 'sha256': digest,
                    'instruction': 'Use the previously returned complete document; do not request it again.'}
        self.loaded[path] = digest
        return {'path': path, 'sha256': digest, 'document': value}


def diagnostic_allowed(pending, ui_attempts, binding_failure):
    """Ordinary successful controls do not justify REA. A UI attempt or observed failure does."""
    return bool(pending) and bool(ui_attempts or binding_failure)
