# REA source reuse

`scripts/vendor/rea_canonical_digest.cjs` adapts `src/domain/canonicalDigest.ts`
from [morluto/rea](https://github.com/morluto/rea), commit
`ed24604ee10362b063feb8610cee1f2049df65c8` (local checkout version 6.4.0).
TypeScript types were removed and a CommonJS export added. The SHA-256 canonical
JSON implementation is used to commit form structure and verified semantic assignments.
Copyright (c) 2026 morluto. The complete MIT license is in [licenses/REA-MIT.txt](licenses/REA-MIT.txt).

The observation/execution split, provenance, explicit coverage limits and exact
origin scoping follow the inspected REA design. Those application-specific tools
are new implementations in this repository, not copies of REA's browser providers.
`scripts/rea_bridge.py` invokes an independently installed/built REA CLI when selected;
it does not bundle REA's binary-analysis providers or install REA at runtime.
