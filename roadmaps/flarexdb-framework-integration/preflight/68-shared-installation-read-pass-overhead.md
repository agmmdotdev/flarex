# Shared Installation Read-Pass Overhead

Status: investigation complete; proposed correction awaits owner approval.
ShippingProfile capability completion remains paused in [record 66](./66-connected-product-shipping-profile.md).

## Outcome And Ownership

Reduce redundant nested read-pass instrumentation in the shared migration
restoration path without changing what it authenticates or when it may reuse
evidence. The first implementation owner is
`packages/persistence-postgres/src/migrationCoordination/graphReadPass.ts`.
Its existing graph-pass tests own lifetime/capacity preservation; the unchanged
seventeen-table ShippingProfile fixture supplies the larger consumer witness.

This advances reliable initial installation for the connected Product workflow.
It introduces no ShippingProfile condition, adapter workaround, new table,
public API, runtime cache, transaction owner or installation algorithm. It is
not a claim that removing instrumentation will solve general history scaling.

The accepted FlarexDB design and package roadmap 16 retain persistence authority
with Postgres. Records 09/10/11 own installation and settlement; record 27 owns
the existing pure-verification and read-only graph lifetimes. Record 49's
duplicate canonical-plan input correction is already present. The implemented
prepared-runtime acceptance path is distinct: it does not replace initial
installation or the cold coordinator reopen.

## Reproducible Evidence And Limits

The selected seventeen-table fixture runs 106 structural steps in batches of
at most sixteen, followed by finalization and a fresh-profile coordinator
reopen. Its existing installation-plus-reopen deadline is 90 seconds. Earlier
isolated PGlite runs timed out before operation assertions. An isolated traced
rerun now passes narrowly; that does not establish resolution of the failures.

Diagnostic runs selected only the existing inventory assertion with
`-t 'installs exactly'`. Both used the actual `commerceHostFixture`, native
coordinator and configured schema. The other two tests were deliberately
filtered out; no native operation or connected-workflow completion is claimed.
The ordinary PostgreSQL role was neither superuser, role creator nor replication
role. Both runs were serialized against the other task's heavy validation.

| Observation | PGlite | Ordinary-role PostgreSQL |
| --- | ---: | ---: |
| Installation plus cold reopen | 88.230 s | 58.813 s |
| Finalization span | 4.496 s | 3.092 s |
| Cold coordinator run | 1.551 s | 1.164 s |
| Structural execution, 106 calls combined | 1.027 s | 0.828 s |
| Actual plan-sidecar restoration loads | 710 | 706 |
| Name-assignment metadata restorations | 189,097 | 188,045 |
| Read-pass helper calls, including nested joins | 39,863 | 39,474 |

Counts and summed owner spans cover the complete fixture, including preparation
and binding, not just the timed installation envelope. Nested inclusive times
overlap and must not be added together. Driver bridges do not all preserve span
parentage, so apparent outer self-time is not a CPU measurement. Tracing adds
observation cost; this is one run per driver, not a controlled speedup result,
production performance claim or proof of the cause of every earlier timeout.
No schema-installation or cold-open bypass was used. Owned database resources
were stopped after the runs.

Local raw diagnostic output is retained in
`work/validation/shared-installation-profile/{pglite,postgres}.log`. The temporary
setup installed a `Tracer` through the test Effect runner and existing migration
verification bridge, preserving the original work and runtime settlement.
It retained names/counts/timings, not SQL parameters or row data, and has been
removed. These mocks are not normal test or runtime dependencies.

The source explains a concrete avoidable operation: `withFrameworkGraphReadPass`
is a named `Effect.fn` wrapper even when its first check finds an active pass
for the same transaction and merely returns the supplied read. Installed
Effect rc.112 constructs call-site error/stack metadata and a named span before
executing that check. Nested restoration repeatedly takes this path. Existing
memo lookup and canonical-capture helpers already use `Effect.fnUntraced` for
the same transparent-helper distinction.

The trace establishes repeated shared reconstruction and identifies a candidate
instrumentation cost. It does **not** establish that all those restorations are
redundant, that a cache bound was exceeded, or how much time this candidate will
save. Full stored-evidence checking remains intentional.

## Recommended Correction And Challenged Alternatives

Use an untraced transparent entry for the existing read-pass helper. When it
actually creates and owns a new pass, retain the named pass span around that
lifetime. Joining an already active exact-transaction pass should not create
another helper span/stack wrapper. Keep repository, restoration and coordinator
operation tracing. This changes diagnostic granularity intentionally, not
failure classification or resource ownership.

Retain the existing function contract, evaluation order, inherited-context
check, exact transaction identity, validation-policy keys, success-only memo
behavior, 512-reference limit and release/interrupt semantics. Do not move
creation or cleanup across a read, write, lock, suspension or settlement edge.
No restored value survives a write or a completed pass as a consequence of this
change. Do not change pure-verification retention or failure causes.

Rejected for this slice: increasing the 90-second deadline or cache capacities;
making PGlite uncancellable; caching restored authority across writes or
transactions; using prepared runtime evidence during migration; weakening SQL
byte/sidecar checks; and introducing a new installation certificate. Also reject
bulk removal of named Effect tracing merely because a span has many calls.

Repeated name-mapping and receipt/event reconstruction remain visible follow-up
candidates. A larger correction must identify genuinely duplicate work under
the existing integrity contract or explicitly preflight a changed contract;
this record does not authorize a new cache or evidence API.

## Validation, Compatibility And Completion Gates

- Retain: all coordinator/repository reads, validation, schemas, identities,
  locks, fencing, rollback, uncertainty recovery, deadlines and consumer inputs.
- Replace: only redundant nested read-pass instrumentation; retain a named
  span for a newly owned pass. There is no shipped API or data migration.
- Extend: deterministic graph-pass tests proving one owning span for nested
  reuse, independent spans for independent passes, exact-transaction refusal
  to reuse, policy separation, capacity behavior, uncached failures and cleanup
  after success/failure/interruption. Do not assert wall-clock timing in tests.
- Delete: temporary diagnostic mocks/configuration after measurement. They must
  not become a production fallback or alter normal test selection.

Before retaining the candidate, compare the exact baseline and candidate on
both drivers with the same seventeen-table fixture, unchanged deadlines and
serialized heavy work. Use uninstrumented runs for completion timing and a
focused trace for the expected span-count reduction; report both separately.
Require at least two candidate installation/cold-reopen passes per driver and
reproducible improvement, not just one lucky pass. Do not claim that this closes
the separate intermittent PostgreSQL storage-stall investigation.

Run affected graph-pass, plan/assignment/receipt/event corruption, coordinator
and installation regressions, including cold reads and changed stored bytes or
projections after a prior success. Preserve the existing small fresh/additive
profiles and Product/SalesChannel consumer checks. Run persistence typecheck,
core/diff/staged lint and both required read-only reviewers against the final
owned diff. Stop owned runtime resources and create one scoped commit only
after validation passes.

If the candidate fails to improve the larger installation meaningfully, remove
it and report that result. Do not expand into authority reuse, storage changes,
broader tracing removal or deadline changes without another focused preflight.
ShippingProfile implementation remains a separate incomplete draft until its
native module, Link and connected-workflow completion gates are met.
