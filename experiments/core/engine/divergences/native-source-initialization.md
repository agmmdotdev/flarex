# Native source initialization outcomes

Status: **Selected fresh Currency initialization contract implemented; general
producer upgrades, populated conversion and native hosting remain gated.**

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` does not require Medusa's
native default Currency dataset or initialization descriptor. Preserve that
required native behavior through existing Core request/outcome settlement,
logically above the same five physical tables. Do not retain a separate physical
initialization receipt or introduce another migration/outcome engine.

The actual producer supplies its checked step, canonical dataset digest and row
count. A real private native initialization callback has an explicit registered
command identity; it is not a fabricated Application function or schema authority.
Capture and verify the dataset before claim/replay. Correlation covers the target
source identity, step, dataset and count. Its deterministic step key is independent
of unrelated bundle contents and host policy; a changed descriptor must fail as
seed mismatch rather than silently create another initialization attempt.

Use Core claim/recovery and one native transaction. The missing-outcome path
proves source emptiness with a bounded index/key presence probe, including
soft-deleted live documents, then inserts the
source-ordered native batches under the existing resource policy. One settlement
persists rows and the canonical result atomically. It is not one framework call
or lifetime per seed row. Committed replay revalidates the binding and exact
stored result before returning without initialization callbacks. Core retains
uncertain-outcome recovery; ordinary command admission requires the committed
matching initialization outcome before native callbacks.

Missing initialization remains `seedRequired`, a different descriptor is
`seedMismatch`, and malformed stored evidence is corruption. Keep initialization
capability out of ordinary command dispatch. General producer upgrades, populated
conversion and reset policy remain outside this selected fresh initialization.
An already nonempty source must refuse as seed mismatch even when it exceeds the
native cohort capture cap. Do not substitute complete find or a 16-entry native
page for the old one-key existence probe. Empty evidence still participates in
the same native acceptance owner, protecting competing initialization/writers.
Final proof retains the selected native identity bound rather than truncating a
larger competing cohort and risking false acceptance. Selected ordinary Currency
commands require the committed initialization outcome, and initializers share
the same step claim. Unbounded privileged maintenance races are not an admitted
initialization profile.

## Known failure and claim revision fencing

Pinned `model/src/session_requests/types.rs` records only completed mutations;
the application function runner writes successful outcomes and drops failed
transactions. The old native initializer likewise rolled back without an
initialization outcome, allowing the same valid step to retry after known
nonacceptance. A deterministic key plus Core's existing terminal failed-request
state would otherwise prevent that required retry.

An opaque database-issued initialization binding selects one native source and
actual registered write command. Only that role can reclaim a matching failed
request, through the existing claim/OCC owner, reusing the same request document
and retaining its revision chain. Claimed/uncertain attempts remain busy;
committed results replay. Other existing Application/native/root failed-request
behavior is unchanged by this bounded extension.

Before beginning or aborting a claim, compare its exact durable request identity,
revision, lease and correlation to the issued claim. State `claimed` alone is
insufficient after reclaim: an old abort must not fail a newer attempt. Mask
acknowledged abort/token retirement together. Reclaim mints a fresh opaque claim
only after acknowledged persistence and clears stale abandonment evidence.
Uncertain writes retain the existing stopped-committer/fenced-recovery owner.
No adapter-generated alternate request keys or second initialization ledger is
permitted. Cover concurrent reclaim, stale abort/finalized handles, mismatched
descriptors and uncertain writes in addition to successful replay.

Prove genuine 123-row Currency initialization/replay, mismatch/refusal, interrupted
acknowledgement recovery, ordinary readiness and cold reopen on PGlite and ordinary
PostgreSQL before cutover.
