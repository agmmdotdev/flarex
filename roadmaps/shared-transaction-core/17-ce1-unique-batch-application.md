# CE1 Bounded Unique Ownership Application

Status: bounded unique application is implemented under standing owner approval.

## Outcome And Contract

Replace the online scalar unique mutation API with one set operation in
`appUniqueKeys.ts`. Authenticate one scope/epoch per call, batch live-parent and
current ownership reads, and apply exact conditional releases and claims in
groups of 32. Existing canonical codecs, hash collision checks and database
uniqueness constraints remain authoritative. The shared native/CMS materializer
keeps its release-before-claim phases so swaps and restores remain atomic.

Each call has distinct constraint/locale/table/row owners and one authority.
Validate all transitions against current ownership before writing. A destination
owned by another row remains a conflict, including a row released in the same
call; transfers use the materializer's two phases. Competing destinations within
a call fail with the existing conflict or hash-collision error. SQL ordering is
sequential, and any failure must escape to the outer transaction for rollback.
There is no partial-success or local recovery contract.

Use the existing stored-claim Schema and exact codecs for foreign evidence.
Verify returned delete/insert identities and bytes as sets independent of row
order. Parent evidence identifies the exact current row/revision and must be
live for a claim. Releases retain their ability to remove a tombstoned parent's
ownership. Omitted and unchanged transitions retain their semantic results.
Canonical locale identity survives sparse omission, so omitted localized
operations neither collapse together nor inspect a different locale's owner.

## Alternatives, Breaks And Cleanup

Do not add parallel statements, a second unique engine, compatibility wrappers,
or trust earlier planning as write authority. A simultaneous transfer API is
unnecessary: the existing two-phase planner already owns swap semantics.

The scalar `applyAppUniqueKeyMutationInTransactionEffect` is removed; its
materializer, build cleanup and test callers use the batch owner. It returns one result
per supplied mutation. Validation/failure order across actions changes; private
per-action hooks run after their phase succeeds. Historical backfill retains
its real reconciliation consumer and distinct replay contract. Remove online-only
helpers displaced by batching; shared backfill helpers remain. No schema,
durable format, public framework capability or transaction boundary changes.
Private `uniqueKeyBatchWriting`/`uniqueKeyBatchWritten` observations bracket
both phases for SQL attribution when there are actions.

## Proof And Completion

Cover 1/32/33/128 claims, releases and unchanged keys; exact owner/locale/scope
isolation; swaps; competing destinations and forced hash collisions; missing or
tombstoned parents; stale authority; duplicate inputs; malformed evidence; and
later-batch failure rolling back earlier writes. Retain native/CMS and unique
build regressions on PGlite and ordinary-role PostgreSQL. The original
32-transition publisher ceiling is superseded by the shared document budget
alignment in the [Currency cutover](../shared-logical-storage/10-currency-storage-cutover.md):
128 aggregate transitions and 256 release/claim actions. Exercise publication
across statement batches and refusal when multiple constraints exceed that
aggregate ceiling; statement batching alone does not authorize unbounded work.
Attribute SQL through the real unique owner and actual materializer; do not reuse the intrinsic-only
publication benchmark to claim unique-key performance. Require affected
typecheck, lint, both project reviews and a scoped commit. Wider CE0/CE1
acceptance and concurrency redesign remain open.
