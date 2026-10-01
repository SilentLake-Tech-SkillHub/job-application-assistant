# Role tracker contract

Read for workbook discovery, writes and status reconciliation. Locate the current workbook and regional sheet through the workspace router and private profile. Do not embed a user's path, filename, columns or personal data in this public Skill. Inspect the actual header and validation before editing.

- The company official recruiting entry and its current plan are separate from a role's **direct official detail URL**. Verify and read back both levels; a list URL or guessed job URL is not a verified role link.
- Record one row per verified in-scope role, title, explicit location, full visible JD, employing unit if shown, plan and direct URL. Keep source wording faithful and document inaccessible portions instead of filling them from a snippet. A company with no verified role retains its existing placeholder semantics.
- Deduplicate by direct URL or job ID, then compare employer, title, unit and location when URLs change. Search current site history as well as workbook status before opening a new application.
- A recorded, unsubmitted role stays in the tracker's existing pending value. Fine-grained stages such as `prepared` and `uncertain` belong in the private run ledger. Set the tracker's submitted value only after an official success receipt; a button click, draft, modal or user statement alone cannot establish it.
- Reread the live workbook immediately before writing; record its SHA-256 and make a recoverable backup for a structural edit. Apply the smallest update, preserve other sheets, formulas, validation and user edits, save, reopen and verify the company entry, role URL, JD, status and formula errors. If the file changed during editing, reconcile or stop before overwriting it. Never treat remembered row numbers as stable.

When site evidence conflicts with the tracker, leave the application stage unresolved until the site account/history is checked. Report the discrepancy and its exact affected roles; do not mass-change statuses or resubmit.
