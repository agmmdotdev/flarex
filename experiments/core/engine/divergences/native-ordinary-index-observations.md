# Native ordinary-index observations

Status: **Selected indexed Payload replacement implemented and validated; wider native and host gates remain open.**

## Source mechanism and required distinction

Pinned Convex at `db914cf06e2b06ee985646611b9e12ed7a770318` uses one
transaction snapshot and conflicts on matching retained index-write events.
`index_registry.rs` rewrites an index entry at each row revision even if the
key is unchanged, enabling exact hydration. `transaction_index.rs` merges
pending entries with consumed physical ranges; prefetch alone is not a read.
Keep these Application mechanisms and physical writes unchanged.

The existing direct native Payload profile preserves remembered rows while
allowing a first untouched query to observe newer published data. It accepts an
empty ordinary range after separate insert/delete commits restore that exact
membership. It rejects a first range before disclosure when a physically present
previously remembered row left and reentered its key, even if a pending move
would suppress that row from output. A non-key update returns the remembered
body and fails later point validation; moving out without return may produce
an empty range before final point failure. Genuine Local API characterization
in the [indexed slice](../slices/11-payload-indexed-scalar.md) fixes these cases.

Replacing these rules with Source event rejection changes admitted native
behavior; retaining old SQL membership generations creates another authority.
The selected adaptation uses the existing Core retained log and native packet.

## First physical capture proof

Record a remembered original's semantic capture time S separately from its row
revision R. For an original live row, its old membership generation is at most
R, and R is at most S. Select the new physical snapshot T and freeze the
corresponding retained log snapshot synchronously before any awaited scan.

For each currently physical candidate that already has an original, require
the same exact full key (including row identity), a live original, and no real
key transition in (S,T]. With complete retained history, no transition proves
the original membership generation is unchanged; a separate key-away/key-back
transition proves it is newer than S and therefore R. A same-key body update
does not create a membership transition, while its ordinary row dependency
still protects final acceptance. An absent original cannot use the live proof.

Derive real transitions from each logical commit's coalesced original/final
keys. Equal original/final keys produce none. Separate committed K-to-M-to-K
changes retain both transitions, even when saved in one atomic physical batch.
Do not replace the raw Source event log or net multiple logical commits.

Capture candidate evidence before pending masking and residual filtering.
Certify only after complete bounded capture has established EOF or overflow;
preserve overflow precedence. Do not certify all remembered IDs, pending-only
rows or an entire unrelated interval. A moved-out row absent from the physical
range has no new physical disclosure to certify. A cached range or a range
derived from an already frozen full table does not initiate another proof.

Require S to lie within the frozen log's coverage. Pruned/missing history is
not proof of no change. Log retention defaults exceeding command deadlines do
not replace this check. Originals are process-local; cold owners start new
captures after their bootstrap floor. Count retained transition structures in
the existing retention accounting and expire them with their owner. Release
the frozen log snapshot after certification; do not retain one per range.

Index/policy generations must remain selected and enabled. New native schemas
are fresh-only and indexes are ready before data; a non-row membership rebuild,
replacement or unsupported activation must refuse/invalidate before disclosure.
Cache warming is not a semantic membership transition.

## Final validation and durability

Capture every consumed raw candidate's row/absence guard, including rows later
hidden by residuals or pending changes. A remembered member cannot change its
generation without a row write, which those guards reject. Exact final full-key
membership equality then protects range phantoms without preserving the old
physical membership-generation family. Unseen insert/delete ABA can restore
the terminal set and accept under the native profile.

Reuse published-state preparation outside the acceptance mutex and pure suffix
refresh. Fold complete accepted-unpublished old/new transitions before equality
and constraint checks. Preserve Native10 selective durability prerequisites for
all earlier relevant accepted batches, including removals and net ABA; a
restoring accepted write must become durable before a dependent decision saves.
No callback replay, I/O under the mutex, second save owner or implicit native
OCC retry is introduced.

The existing native bound applies to physical published-state preparation
before comparison. If that preparation itself has 257 members, it fails capacity
before folding a possible accepted removal; this preserves the native bounded
read gate rather than scanning an arbitrarily large set to rescue it. When
published preparation is within the bound, fold the entire accepted suffix and
check its terminal membership against the bound before equality. Intermediate
accepted states may grow and restore the set; do not apply a new per-batch cap.
These resource refusals do not weaken the durability prerequisites of any
accepted decision.

Preparation is asynchronous and outside the ordering mutex. Starting one submit
before another does not prove its acceptance order. A witness requiring an
observer to validate before a replacement must synchronize the actual mutex
decision while the restoring save remains blocked. A replacement accepted first
correctly makes a later free-key observation conflict; accepting that observation
would weaken the native guarantee. The selected concurrency fixture now guards
that ordering rather than relying on fiber-fork order.

## Required witnesses and limits

Carry the five genuine characterization cases to the replacement on PGlite and
ordinary PostgreSQL. Add same-commit coalescing versus separate-commit ABA,
frozen-log concurrency/pruning, overflow precedence, pre-mask and residual-hidden
candidate guards, cached-range/full-table order, pending movement and bounded
captures. Keep raw Source same-key/by-ID conflict regressions. Prove accepted
restore failure/uncertainty, cancellation and unrelated save progress. Native
DO hosting, retained-data migration and complete-flow performance remain open.
