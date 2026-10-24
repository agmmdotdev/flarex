# Native Order Change decline workflow

## Status and scope

Implementation in progress; validation and admission remain pending. The
proposed private `flarex-order-change-decline` / `order.changeDecline` profile
covers one existing pending or requested Change. The complete Order definition,
shared Change contracts and trusted queued workflow owner remain authoritative.
Creation, confirmation, Actions, finance, transfer-workflow activation, delayed
compensation and public/hosted deployment remain separate gates.

## Native behavior and inverse gate

Pinned Medusa 2.13.4 `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` owns
`declineOrderChangeWorkflow`, its retained step, service guard, metadata
preparation and module events. The workflow has one native step and a void root.
Input contains ID, optional declined actor and optional object/null metadata.
The service sets declined status and time after its pending/requested guard.
It does not accept a decline reason or change the stored reason.

The pinned step omits prior status from its selected preimage, retains the DTO
without detaching it, and compensates through ordinary `updateOrderChanges`.
That update merges metadata and can mutate the retained inverse input. Source
inspection identifies an exact-undo gap, retained in original SQLite and
ordinary-role PostgreSQL witnesses. The explicit decline correction decision
authorizes exact restoration of status, decline time/actor and submitted
metadata, including the shared transfer step's inverse. Corrected witnesses
remain separate from those original comparisons.

The approved correction is a detached preimage containing ID, prior status,
declined time/actor and metadata only when submitted forward. The implemented
named existing-row restoration method uses the existing native metadata
replacement option. It must not upsert, recreate a missing Change, apply the
forward active-status guard during inverse, or invent a prior status. The shared
native step is also consumed by `declineOrderTransferWorkflow`; correcting its
undo does not admit that wider workflow.

The restoration method uses `@InjectManager()`, `@EmitEvents()` and
`@InjectTransactionManager()` in that order, following the native SalesChannel
pattern so native owned-transaction event draining follows its flush. This does
not establish atomic standalone publication, bus-rejection recovery, or flush
and event draining for externally borrowed native transactions. The Flarex
borrowed path captures native calls before trusted outer settlement.

## Ownership and compatibility

Reuse [Change cancellation](./order-change-cancellation-workflow.md),
[Order foundation](./order-archive-foundation.md), the shared logical storage
design and the existing atomic workflow host. Full rows and owning Order
references derive from checked Order DML before projection. Native metadata
normalization and selected business-Date capture retain their existing owners.
Decline field/status authority and its mutation receipt stay explicit.

Forward metadata follows the admitted Drizzle assignment lane: omission keeps
the current value, null and empty objects clear it, and nonempty objects use
native shallow merge with empty-string patch values deleting keys. The exact
inverse preserves prior null, literal empty strings and nested values. Own
recursive `__proto__` keys remain outside the supported assignment domain;
ordinary `constructor` and `prototype` business keys remain admitted.

As with cancellation, the proposed portable DTO follows the existing
PostgreSQL presentation profile. It does not claim identical raw Drizzle
presentation or Mikro dirty checking. A repeated unchanged inverse can be a
native Mikro no-op without an update event; the Drizzle lane issues another
update. The bounded logical profile retains ordinary write semantics for each
admitted inverse, including its managed timestamp and actual-write event.

Forward and inverse writes each retain the native
`order.order-change.updated` module event. The root emits no separate workflow
messages or hooks. Replay, scope confinement, sticky refusal and queued borrowed
calls belong to the existing trusted owner; no raw database capability, new
transaction lifetime or independent settlement path is introduced.

The native Order class retains its finance helper extraction and cancellation
restoration. Its canonical whole-source proof composes cancellation, finance
extraction and decline in that order; the new decline leaves have separate
complete proofs. Shared targets retain one promotion record and native helper
proofs. Source, declaration/runtime emissions and promotion metadata must
describe coherent candidates without staging another session's edits.

## Remaining gates

Preserve original native witnesses and prove corrected forward compatibility
and exact repeated inverse behavior
on SQLite and ordinary-role PostgreSQL. Adapter admission requires PGlite and
ordinary-role PostgreSQL coverage for metadata omission/merge/null/empty values,
unchanged reason and Actions, terminal/missing/historical rows, historical
parents, missing inverse targets, late rollback, replay, scope separation,
queued calls and escaped methods. Receipt negatives must authenticate exact
before/after rows and canonical decline time rather than assume observations
are preimages. Use Ping tsc-rs for affected typechecks, plus source/promotion,
portability and required review gates before activation of this private profile.
