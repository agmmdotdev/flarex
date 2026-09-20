# Membership Read Preparation

Status: operation-local preparation implemented; broader runtime and latency
acceptance remain open.

## Outcome And Owner

Membership lookup previously constructed an empty range request per distinct
located definition, including a repeated read of the same scope identity.
Shared definition capture and physical-spec preparation are now separate from range
bounds/cursor/limit handling in `appIndexEntries.ts`. Authenticate scope identity
once per nonempty membership-read operation. Keep definition preparation cached
only by issued object identity within that operation, and validate every key and
row before the existing 32-position storage reads.

This corrects the shared reader used by multi-index preparation. It does not
combine intrinsic/developer logical preparation or claim to resolve the open
one-row paired-latency miss. No new framework capability, authority service,
global metadata cache, skip-validation flag or prepared-authority token belongs
in this slice. The existing reader remains the only owner of membership history
and current-pointer authentication.

## Authority, Ordering And Compatibility

The scope read authenticates the immutable scope-ID/UUID mapping, not generation,
epoch or serving readiness. Their existing owners remain responsible. This
operation does not require or acquire a scope-clock lock. Scope-clock deletion
and rebinding cannot become an informal revocation protocol for this private
reader: each new operation rechecks identity, while callers still own their
transaction snapshot and applicable authority/fencing checks.

Preserve input order: capture and hash each distinct definition, check scope for
the first definition, then validate that position's key and row. A later invalid
definition must fail before membership SQL. Retain exact range-input validation
order, including bounds shape before definition capture and cursor/limit before
hashing or scope SQL. Empty membership requests still return without validation
or SQL. Remove fake range inputs and redundant per-definition scope reads.

Capture the operation's scope ID once and each position's issued definition,
key and row before awaiting its preparation. Caller mutation during hashing or
scope I/O cannot reassign the cache key, substitute row/key values for that
position, or combine a later definition's scope with the first scope's UUID.

No public signature, stored schema/codec, data migration, driver contract or
framework behavior changes. The private reader's repeated observation of scope
identity is replaced with one operation-level check; no cross-operation reuse
is allowed. Existing malformed-storage, typed SQL failure, construction defect,
digest, history and pointer checks remain intact.

## Completion Gates

Use authentically located mixed definitions and their distinct key shapes to
prove exact live/missing/tombstone results across the 32-position boundary,
one scope read per operation and fresh validation on a subsequent call. Prove
forged/cross-scope definitions and incompatible keys fail closed; retain range
error precedence and empty-input behavior. Mutate the caller's scope and position
during the first scope read to prove the capture boundary. Run both PGlite and ordinary-role
PostgreSQL owner and affected consumer regressions, typechecks, required lint
and both read-only reviews. Remove displaced preparation, reconcile the owning
roadmap, stop temporary resources and commit the coherent slice.

Report scope-read counts as bounded SQL evidence, not latency or capacity proof.
The broader CE0 comparison misses and CE1/CE3/CE5 gates remain open.

## Interpretation

The shared reader uses one scope read across distinct issued definitions,
including separate issued objects for the same physical definition, and checks
again on each new call. The mixed-table native publication path uses one scope
read and one membership query for its four positions, replacing three SQL calls
with two. Membership SQL still chunks at 32 positions, preserving input order
and exact live/tombstone/missing results. Scope-clock deletion between operations
fails the next call; forged and cross-scope definitions never reach membership
SQL. This is a bounded query-count correction, not a latency claim. The one-row
paired-latency miss remains open.
