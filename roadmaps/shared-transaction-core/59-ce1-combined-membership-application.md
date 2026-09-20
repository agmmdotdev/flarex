# Combined Membership Application

Status: combined shared membership application implemented; wider runtime and
latency acceptance remain open.

## Outcome And Owner

The request attribution identifies duplicated scope/head/parent checks and split
writes between intrinsic and developer memberships. Both already use the same
`appIndexEntries.ts` online batch contract. Combine their prepared transitions in
`applicationDocumentMaterialization/materialization.ts` and call that owner once.
Keep intrinsic and developer logical preparation, omission decisions and budgets
separate. Native and CMS consumers share this correction without adapter changes.

No new writer, trusted bypass token, skip-validation flag, cache or transaction
owner is needed. The existing batch operation accepts mixed definitions and
rejects duplicate positions; reuse it rather than duplicating its validation.
Keep the 32-transition SQL chunks and all scope/epoch, membership history,
parent, conditional-current-write and exact RETURNING checks. Combining calls
does not guarantee fewer physical chunks at every input size.

## Ordering And Breaking Changes

Combined inputs place intrinsic transitions first, then the existing ordered
developer transitions. The index owner validates the entire input and membership
transition set before applying bounded chunks. Invalid developer input may now
fail before any intrinsic write; this private failure order replaces the old
two-call sequence. No partial result is published and every failure still
escapes to the physical transaction owner for rollback.

Rows still apply first, memberships second, uniqueness third, and publication
last. Intrinsic build-validation reset follows the successful combined call;
candidate/unbound lifecycle behavior remains covered. Per-kind action hooks
remain logical notifications after application, not individual SQL or commit
receipts. Replace private intrinsic-only batch hook names with
`indexBatchWriting`/`indexBatchWritten`; replace SQL write operation names with
`writeIndexEntries`, and name intrinsic preparation failures by their actual
head-read operation. Migrate native/CMS tests, measurement and reference hooks.
Delete the displaced developer-only write helper and obsolete labels.

No public API, persisted codec, table, migration, limit, scope-clock protocol or
framework capability changes. Existing direct index-writer and backfill callers
retain their distinct authority contracts and full validation.

## Proof And Completion

Prove one combined call and bounded SQL behavior for 1/16/17/32 rows with both
indexes: sixteen rows fit one 32-membership chunk; seventeen cross it. Verify
exact row/index/publication state and replay. Preserve native intrinsic-only and
developer-only scenarios, mixed insert/update/delete, unchanged memberships,
unique swaps, corruption refusal, malformed returns and rollback after writes.
Exercise PGlite and ordinary-role PostgreSQL owner/consumer regressions, types,
core/diff/staged lint and both read-only reviewers. Refresh scalar attribution
after correctness, reporting counts without treating attribution timings as
latency proof. Remove displaced helper/labels, reconcile roadmaps, stop owned
resources and commit. Broader CE1/CE3/CE5 and readiness-root gates remain open.

## Current Interpretation

One combined call retains all storage validation and the existing 32-transition
chunks. Native rollback/retry also retains exact unchanged intrinsic membership
history/current state while developer keys and unique ownership move.
The prior separate calls and their helper/hook/operation labels are removed.

The selected complete requests remove five SQL calls for one/eight-row inserts
and one for thirty-two-row inserts. Smaller requests eliminate one scope read,
one membership-head read, one parent check and two writes; larger requests still
need two chunks and eliminate only the repeated scope read. These are scoped
SQL-count reductions, not permission to enlarge chunks or omit checks.

The refreshed paired comparison misses the normal relative-latency target for
one-row mutations. Observer calibration also misses for the reference empty
read/empty mutation and core one-row mutation. Preserve these misses; the result
does not establish an overall latency improvement or its causal absence. Keep
normal timing separate from instrumented evidence and attribute any further
cost before another correction. Five pairs cannot establish capacity or tails.
