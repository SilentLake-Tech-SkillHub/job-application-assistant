// A host privacy sentinel is unavailable evidence, never an observed value match.
// Do not trim, fuzzily match, or replace it with the planned answer.
export const REDACTED_READBACK_REASON='REDACTED_VALUE_UNVERIFIABLE';
export const isRedactedReadback=value=>value==='<redacted>';
