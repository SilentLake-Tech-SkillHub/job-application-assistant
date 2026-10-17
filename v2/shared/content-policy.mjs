// Site-specific exclusions come from the private profile, never from model decisions.
// Reject relocated content before writing; verification applies the same rule to readback.
const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const leaves = value => Array.isArray(value) ? value.flatMap(leaves) :
  value && typeof value === 'object' ? Object.values(value).flatMap(leaves) :
  value === undefined || value === null ? [] : [normalize(value)];

export function resolveContentPolicy(profile, companyId) {
  const policy = profile.applicationDispositions?.[companyId]?.contentPolicy;
  if (!policy) return {excluded: []};
  if (!Array.isArray(policy.excludedFactKeys) || !profile.sources[policy.evidence]) throw Error('INVALID_CONTENT_POLICY');
  return {evidence: policy.evidence, excluded: policy.excludedFactKeys.map(source => {
    const fact = profile.facts[source];
    if (fact?.status !== 'known' || fact.value === null || typeof fact.value === 'object') throw Error('INVALID_CONTENT_POLICY_FACT');
    const value = normalize(fact.value);
    if (!value) throw Error('INVALID_CONTENT_POLICY_FACT');
    return {source, value};
  })};
}

export function contentViolations(values, policy) {
  const strings = leaves(values);
  return (policy?.excluded || []).filter(rule => strings.some(text => text.includes(rule.value))).map(rule => rule.source);
}

export function assertContentPolicy(values, policy) {
  if (contentViolations(values, policy).length) throw Error('EXCLUDED_CONTENT_RELOCATED');
}
