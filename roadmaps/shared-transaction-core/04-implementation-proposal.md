# Remaining Implementation Proposal

## Status And Approval Boundary

Proposed from the [completed ownership audit](./01-ownership-audit.md).
Implementation is not started. R1 and R2 are required to reconcile the default
shared-owner design; they do not admit new framework behavior, tables, public
APIs or execution profiles. Approval may cover both in this order, with each
completed and validated before starting the next. Routine implementation choices
inside the approved scope do not require repeated permission.

## R1 Neutral Physical Resource Owner

### Problem And Target

`relationalTransaction/session.ts` depends on artifact-control driver creation,
deadlines and resource errors. `frameworkSchema/artifact/postgresControlSession.ts`
owns the reusable PostgreSQL mechanics while also composing artifact tables and
implementing the artifact-facing driver contract.

Create a source-private physical resource owner within persistence-postgres.
Its bounded PostgreSQL driver owns acquisition, connection identity, deadlines,
query tracking and work fencing, drain, cancellation/quarantine, physical
settlement classification and release. Artifact control and relational sessions
consume that owner through narrow adapters. Physical mechanics must not import
artifact repositories, tables, decisions, admission tokens or error classes.
The neutral owner is not a new public generic transaction capability.

Keep artifact `created`/`existing` decisions, resolution after uncertainty,
starter/transaction-token issuance, read/reset policy and error projection with
artifact control. Keep framework request recovery and command error projection
with relational sessions/hosts. Physical recovery operations may preserve an
excluded connection identity; deciding what an outcome means stays with callers.

### Connected Consumers And Contract

- Switch `relationalTransaction/session.ts` directly to the neutral driver,
  deadline and resource result. It currently borrows only the initial-transaction
  operation; do not accidentally compose artifact recovery into framework work.
- Refactor `frameworkSchema/artifact/postgresControlSession.ts` into artifact
  composition/projection over the same physical implementation. Adapt
  `controlSession.ts` and `repository.ts` where generic physical types/deadlines
  currently cross the artifact boundary.
- Keep schema construction typed and owner-supplied. Artifact tables belong in
  artifact composition; the neutral driver must not acquire control authority
  simply to construct a business transaction. Preserve supported Drizzle calls
  and exact database identity checks, without a broad cast or arbitrary SQL API.
- Preserve `committed`, confirmed callback rollback, callback cleanup failure,
  pre-commit failure and uncertain acknowledgement distinctions, complete Cause,
  callback finalization, interrupt masking and normal-release failure handling.
- Preserve exact-session authenticated cancellation, bounded drain/destruction,
  destruction of late acquisitions, no extra pool slot for cancellation, and
  physical identity exclusion where recovery requires it.
- Preserve artifact reads and resets as well as both transaction operations.
  Extracting only the happy-path BEGIN/COMMIT loop would leave duplicated cleanup.

Direct PostgreSQL composition consumers are artifact admission/control tests,
`frameworkCoordinatorPostgresFixture`, `commerceHostFixture`, framework binding
PostgreSQL tests and Medusa Product installation tests. Relational, CMS/Payload,
Currency and Product hosts consume the relational adapter indirectly. Update
these compositions and failure hooks without weakening assertions. PGlite
fixture session issuers remain test adapters; do not describe them as production
PostgreSQL lifecycle proof.

Retain the native located pool/connected-client runner, its Promise/Effect
projection and native retry policy. Retain the migration target DDL lifecycle.
They have different ownership and supported budgets; neither is a second
framework business committer. Merging those implementations is not required by
R1 and would need a separate contract if subsequently justified.

### Deletion And Proof

Remove artifact physical imports from `relationalTransaction`, displaced
physical helper implementations from the artifact owner, and superseded neutral
mechanic declarations there. Retain only artifact-specific projections and
composition; do not leave a forwarding implementation with a second resource
state machine. No new package export, persisted codec, DDL, backfill or sweeper.

Decisive coverage: artifact read/initial/recovery paths; enclosing Effect clock;
query drain before COMMIT; non-COMMIT response; callback plus rollback/release
failure; interruption/finalization; late acquisition destruction; stalled
cancel/quarantine; excluded recovery connection; and ordinary-role relational
lock/cancellation/uncertain settlement. Re-run affected native, CMS/Payload,
Currency and Product preservation cases and package/source boundaries. Native
connected-client ownership remains covered by its existing runner suite.

## R2 CMS Participant And Application Materialization

### Problem And Target

The native `pointCommitTransaction.ts` currently owns CMS preparation, admission
entry, error projection, document and preference closure consumption, receipt
authentication, preference fact publication and finalization. It also owns the
row/index/unique/relation materialization machinery genuinely shared with native
Application. The native OCC module should not depend on CMS lifecycle policy.

Move CMS orchestration to `cmsTransaction/publication.ts` or an equivalent
source-private CMS participant. Extract the connected shared document
materialization capability under an Application data owner, consumed by both
native commit and CMS. It has no dependency on CMS admission or native session
issuance and grants no authority to arbitrary callers. Folder spelling is an
implementation detail; dependency direction and capability ownership are gates.

### Connected Operation And Consumers

Move `prepareCmsApplicationCommit`, `enterCmsApplicationCommit`, CMS preparation
registry, `cmsKernel` error projection and `CmsMaterializationTestHooks` out of
the native module. The sole direct source caller is `cmsTransaction/host.ts`.
Its test hooks reach CMS/Payload scenarios indirectly.

Extract the shared helper dependency closure needed by both participants:

- Definition preparation for intrinsic/developer indexes, uniqueness, candidate
  schema guard and Application relations, using only necessary authority ports.
- Index-build locking before CMS business work; head/dependency consistency;
  unique-transition and index-revision budgets; relation target/restrict planning.
- Candidate schema checks, row revisions/current rows, index revisions/current
  entries, unique transitions, edge/adjacency maintenance and validation resets.

Keep native snapshot/journal/OCC validation, session authority, retry, lease
completion and native error contracts with native commit. CMS retains pending
visibility, supported lifecycle timing and its admitted error mapping. Narrow
CMS materialization options away from the whole native proof-options bag; keep
existing hooks with test support and preserve their failure checkpoints.

The new materializer must preserve authenticated preparation and one-use
transaction-bound finalization; structural arguments alone are insufficient.
CMS consumes authentic document and preference closures, accounts for every
attempt including rows with no final mutation, and proves complete receipts
before publication. Shared lowering may produce private evidence, but must not
expose a generic fact minting interface or manufacture native executor authority.

Preserve exact operation/lock order and SQL behavior. Native and CMS both use one
lowering implementation. CMS preference facts still occur between publication
prefix and clock, inside the same physical transaction. A failure at any point
must roll back business state, facts, retained result and wake together.

### Deletion And Proof

Remove CMS admission/lifetime/closure/preference imports and CMS entry points
from native commit. Switch the CMS host to its participant and both participants
to the shared materializer. Remove displaced helper bodies; do not retain a
native-to-CMS forwarding facade or duplicate lowering. Preserve native public
entry points/error identities and the shared publisher. No DDL or durable data
migration is needed for this ownership change.

Decisive coverage: native OCC and row/index/unique/relation preservation; CMS
pending insert/update/delete and nested reads; wrong/closed admission; missing,
extra, reordered, duplicate or forged receipts; no-final-row attempts; relation
liveness/restrict; preference deletion identity/facts and late rollback; output
limits; retained result recovery; and unchanged pinned Payload lifecycle cases.
Commerce publication remains a regression guard for shared publisher behavior.

## Performance Acceptance Decision

Capture a baseline before modifying either implementation, then repeat comparable
workloads after the replacements. Functional tests may run serially, while the
benchmark deliberately controls concurrency. Keep current transaction deadlines,
query budgets and scope-lock order. Separate environment/setup cost from command
latency and include failed samples; a successful rerun cannot erase a failure.

Proposed criteria for approval: no additional physical transactions or SQL
round trips on unchanged workloads; no new correctness or deadline failures
outside deliberate fault injection; at most 10% regression in p95/p99 command
latency and p95 lock wait/hold time; at most 5% throughput loss; and no increase
in peak checked-out connections or residual checked-out work after completion.
Near-zero timing baselines require a declared absolute noise floor before the
comparison. Freeze workload inputs, concurrency, warmup/sample counts and that
noise floor in the benchmark manifest before modifying R1. These margins are
proposals, not measured results or an accepted production SLO. Existing deadlines
remain hard constraints. Unstable baselines require an inconclusive result, not
revised thresholds. Detailed measurement dimensions and completion rules live in
[validation](./03-validation-and-completion.md).

The main performance risk already exists: same-scope framework writes retain
the clock lock throughout admitted business work, competing with native writers.
The ownership refactors do not promise to reduce that duration. A measured
failure requiring later lock acquisition, wider deadlines or another execution
profile is a separate concurrency/resource design decision.

## Completion And Independent Work

Each approved replacement finishes with all consumer switches, obsolete logic
removed, affected checks and required significant-change reviewers passed, and
an explicit no-DDL disposition. Test receipts and chronology belong outside the
living roadmap. Overall completion additionally requires measured validation or
an explicitly accepted limitation.

Do not absorb public `ctx.cms`/`ctx.commerce`, root Payload settlement, mixed
binding admission, named atomic composition, general mixed OCC, durable events,
legacy-engine retirement or Product scale into these ownership refactors.
