# Direct Core Performance Harness

## Status And Outcome

Implemented for the bounded five-scenario graph. The daily measurement loop uses
`packages/executor/test/performance/`, composing the actual Payload Local API,
Medusa workflows and Flarex execution/persistence owners directly in Node.
The initial scope replaces test composition, not runtime admission, transaction,
journal or publication semantics. After the direct runner reproduced both mixed
failures, the owner additionally authorized fixing those failures at the shared
owner and optimizing the measured harness costs. This is a bounded resumption of
slice 20's failing connected consumers, not approval to silently replace its
authority, transaction, journal or publication contracts.

The daily runner separates one optional SQL diagnostic from quiet request samples,
retains bounded native seed hosts, and reports setup and cleanup explicitly.
The shared source-preparation and finite document-rejection defects described
below are corrected at their persistence owners. The
[measurement ledger](../../packages/executor/benchmarks/core-performance/README.md)
owns direct-run observations and remaining cost attribution. Cold readiness and
index construction still prevent consistently meeting the selected command and
matrix targets; native request parity remains outside this harness completion.
Historical full framework measurements retain their original cohorts and host
boundary. Standalone Payload and Medusa already invoked framework hosts directly,
so removing Worker transport alone does not explain their harness improvement.

## Ownership And Execution Contract

- Executor test support owns complete mixed scenario composition and the direct
  test driver. Framework adapters retain their native operations and workflows;
  persistence retains database setup, admission, execution and settlement mechanics.
- Core measurement must not import backend runtime, Miniflare or Workerd. Host
  integration tests receive their Worker driver explicitly and share the same
  scenario assembly. No production dependency on the framework adapters is added
  to executor or persistence.
- Reuse the existing runtime-neutral execution contract and restricted journal
  capabilities. A trusted in-process fixture is not a sandbox or hosted-security
  proof. Preserve normalized inputs, syscall ordering, framework hooks, pending
  state, fresh authority checks, OCC, seal, publication and real commit behavior.
  The direct transport adapter captures inputs before queueing and checks exact
  acknowledgements inside its terminal-failure boundary. Only authenticated point
  document-validation refusals retain the existing catch-and-retry behavior;
  participant failures and malformed acknowledgements still abort drain.
- Prepare one database installation and bounded framework host per selected
  series. Each invocation gets fresh request/attempt state and isolated input.
  Do not cache authority across requests or substitute an enclosing rollback for
  real transaction settlement. Setup and seeding remain outside request timing.
- Default to one selected scenario and a short warm series. Full sampling and SQL
  diagnostics are explicit options. SQL diagnostics use a separate invocation;
  small sample sets report observations and median without a P95 claim.
- Report loading, preparation/provisioning, seeding, request execution, checks,
  cleanup and total runner wall time where those boundaries are available.
  Failed invocations remain failures with partial counts clearly identified.

## Replacement Inventory

| Existing contract or path | Disposition |
| --- | --- |
| Backend-owned shared mixed fixture assembly | Move to executor test support; migrate all actual test consumers and remove the displaced assembly. |
| Worker construction and dispatch in shared fixtures | Extract as an explicit backend test adapter; retain for Worker lifecycle, transport and isolation witnesses. |
| Standalone Payload preparation in its latency test | Extract reusable test preparation; preserve the existing operation, admission and catalog assertions. |
| Medusa standalone workflow preparation | Reuse its adapter-owned fixture and real workflow host. |
| Full backend performance matrix | Retain as an explicit host integration measurement; it is no longer the default daily core loop. |
| Existing benchmark reports and raw evidence | Retain as historical measurements with their original execution boundary. Never relabel them as direct-core results. |
| Runtime/public APIs, schemas and durable journal formats | Unchanged; no migration or durable-data deletion. |

No compatibility forwarding wrapper is needed for moved private test assembly:
migrate its consumers in this slice. Host adapters remain because named Worker
tests still need them, not as a fallback for the direct runner.

## Validation And Completion

1. Focused CLI/report tests cover scenario selection, sampling, failures and
   cleanup. Typecheck affected test composition and preserve source boundaries.
2. Exercise actual standalone Payload and Medusa plus mixed Product against an
   ordinary PostgreSQL role. Keep an affected fast PGlite correctness witness.
3. The direct mixed Payload/workflow paths must reproduce the paused failures or
   explain their difference with concrete boundary evidence. Do not bypass the
   failing admission or raise budgets. The owner's follow-up authorizes correcting
   the reproduced `LogicalSourceAdmissionError: sourceMismatch` at its actual
   owner, with a focused witness and unchanged authority/isolation guarantees.
4. Check real committed results and rollback behavior, and a focused Worker
   integration witness after driver extraction. Detailed runtime recovery suites
   retain their own scope; a passing direct run is not hosted acceptance.
5. Measure command-to-exit wall time and disclose setup costs. A selected warm
   scenario target of 5–15 seconds and small-matrix target below one minute are
   engineering targets, not assumed results. Missing targets require attribution,
   not hiding work outside the reported runner total.
6. Both project reviews, affected checks, cleanup of displaced paths and a scoped
   commit complete this harness slice. Stop owned validation resources afterward.

This does not close slice 20, establish native parity, change production compute
hosting, or authorize broader framework capabilities.

## Authorized Failure And Iteration-Cost Follow-Up

Both direct mixed Payload and workflow requests reproduce the existing Worker
failures before publication. Their preserved nested errors identify
`LogicalSourceAdmissionError: sourceMismatch`. The localized defect is the
transaction-local full-binding observation reuse in
`logicalDocuments/sourceAdmission.ts`: a later prepared source can return from
the shared binding check before its bounded selected-projection preparation has
been initialized. The Product selection has that state while Payload or another
workflow source does not, so the later finite query-required read refuses it.
The replacement must carry genuinely authenticated preparation through the shared
observation with exact target/binding identity and bounded lifetime. A structurally
similar or foreign token must not acquire authority. Preserve the rejecting
witness and correct this owner rather than omitting the failing operation.

The selected private repository extension transfers only the immutable,
repository-authenticated selected structure from a successful shared binding
observation into the recipient source's own bounded preparation. Both leases must
be open; target location, protection token, database/epoch identity and retained
head sequence/digest must match. The destination retains its own preparation
lifetime and byte charge. This adds no SQL, transaction or settling authority;
later fresh head/schema/demand and final-guard checks remain required. Repository
tests must refuse foreign, stale, mismatched or closed preparations and preserve
detached output ownership. No schema or durable-format migration is needed.

A new recipient requires the accepting transaction's protected final guard and
real bounded donor and recipient leases. An already retained recipient with the
same authenticated identities and head needs no second retention or byte charge.
That no-op must also work during full publication verification, where fresh full
SQL authentication has already happened without a selected-read final guard.
Requiring a guard for that no-op incorrectly refuses final commit; omitting it
for a new recipient would weaken the selected-read preparation contract.

Completion requires successful native Payload/workflow results, real atomic
publication, relevant refusal/rollback coverage, and the affected ordinary-role
PostgreSQL/PGlite checks. Record a materially changed correctness contract here
before implementing it. No public API, durable-data deletion, production host
lifetime change or wider finite settlement redesign is included.

Harness cost work must attribute module loading, migration/installation, framework
preparation, seeding and cleanup before selecting a correction. Transform caching
may reuse compiled test modules; it must not cache request outcomes, live authority
or database state across unrelated runs. Reusing a migrated test installation
requires explicit isolation, cleanup and invalidation behavior. Keep command wall
time visible, and compare the same selected scenario and sampling plan.

The selected setup optimization retains native seed/read/tag-retirement hosts
inside one finite series, with fresh request keys and independent real commits.
Independent disposable control/target provisioning may overlap; both operations
must settle before failure cleanup begins. Readiness/index builders retain their
existing scope-clock ordering. Cold catalog/admission/index construction remains
the main iteration cost; reusing state across commands would require a separately
defined prepared-session lifetime and invalidation contract.

## Connected Pre-Effect Validation Correction

The real direct/Worker transport comparison exposes a second shared-owner
contradiction: the finite point journal unconditionally aborts and discards its
retained evidence when Application document validation rejects a proposed write.
The runtime and executor RPC permit the caller to catch that authenticated
pre-effect rejection, but its next valid call then receives `journalFailed`.
This violates the accepted mixed design's catchable pre-effect validation
contract; changing the transport cannot repair the finite journal state.

The owner's failure-fixing follow-up includes correcting that actual journal
owner. Extend the bounded runtime inventory to `sessionJournalStore.ts` point
failure classification. Preserve the rejected operation's error, earlier accepted
work, and the unconsumed syscall sequence. The exception is only one genuine
typed document-validation failure from the validator before staging any point,
receipt, counter, creation cursor or write event. Defects, interruption, combined
causes, authority/storage/final-guard failures and framework failures remain
root-aborting. This is not savepoint recovery and does not add a transaction,
change durable formats or make partially staged native work catchable.

Correlate the exception to the exact error object emitted at the document
validator, rather than exempting every matching class from the outer transaction.
Insert planning only chooses a candidate identity/time before validation. Patch
and replace planning may hydrate a point-read cache entry; on this precise
rejection remove only an entry newly introduced by that operation, preserving
pre-existing reads and accepted work. Keep final-guard and combined failures
outside that exception.

Validate the real rejected-then-valid operation through both transports and
PGlite/ordinary PostgreSQL. Include earlier accepted work, unchanged rejection
sequence/evidence, committed output and terminal-failure witnesses. Both reviews
must inspect the staging order and exception identity before this slice closes.
