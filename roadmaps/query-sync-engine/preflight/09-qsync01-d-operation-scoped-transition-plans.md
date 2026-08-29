# QSYNC01-D Operation-Scoped Transition Plan Preflight

## Status

**Preflight status:** accepted on 2026-08-29, docs only.

This record completes the `QSYNC01-D0` architecture freeze. It authorizes no
TypeScript implementation. The first proposed code checkpoint is the separate
`QSYNC01-D1` medium slice defined below and still requires explicit approval.

`QSYNC-FX01-C1`, `QSYNC-FX01-C2`, and `QSYNC-FX01-C3` remain blocked. No
Cloudflare SQLite schema, local storage generation, migration, Durable Object
state adapter, Postgres source, evaluator, publisher, route, or production
caller is authorized by this preflight.

The accepted correction is one private, runtime-neutral family of pure
operation-scoped transition planners inside the existing
`@flarex/query-sync` package. The complete `QuerySyncState` aggregate remains
the deterministic reference representation and global oracle; it stops being
the required input to a future durable store transaction.

## Decision Summary

| Question | Decision |
| --- | --- |
| Is a second sync package needed? | No. The seam belongs in the existing private `@flarex/query-sync` package. |
| What is the final import boundary? | `@flarex/query-sync/internal/transition-plan`, with no package-root export. |
| Does `QuerySyncTransitionState` change? | No. Its nine receipt-only operations remain the semantic state port. |
| What do planners consume? | A decoded scope summary plus only the bounded facts required by one operation. |
| What do planners return? | A frozen no-write or write plan containing the core-owned receipt, exact logical compare facts, an operation-specific atomic change, and exact next metrics. |
| How are multi-stage reads represented? | Closed domain read intents plus nominal, process-local resume capabilities; never callbacks or host cursors. |
| Does the planner run Effect or own transactions? | No. It is synchronous pure policy returning Effect v4 `Result`. The host owns serialization, transactions, clocks, and Effect lifting. |
| Who owns counters and limits? | One portable accounting/invariant owner shared by the planners and aggregate builder. Adapters never reproduce semantic arithmetic. |
| Is the old aggregate reducer retained as a second authority? | No. Aggregate APIs become planner-backed compatibility/oracle wrappers and displaced semantic branches are removed. |
| When may FX01 SQLite work resume? | Only after D1-D4 complete all nine planners and a fresh FX01 checkpoint explicitly approves the adapter slice. |

## Why This Gate Exists

`QSYNC-FX01-B` proved that Cloudflare SQLite can host the accepted semantic
state and that each of the nine operations has a bounded logical access plan.
It also found the core seam mismatch:

- current reusable reducers consume the complete `QuerySyncState`;
- material mutations rebuild and revalidate the complete aggregate;
- evaluation selection rotates and examines the complete query array;
- initialization is expressed independently in two reference paths; and
- the reference store detects a write by comparing complete-state identity.

A real adapter therefore cannot use current reducers with bounded normalized
reads. Loading the maximum aggregate would be unsafe under the host memory
budget, while recreating reducer decisions, invariant checks, and counter
arithmetic in SQL would create a second engine. A partial synthetic aggregate
would be neither complete nor authoritative.

QSYNC01-D fixes that seam in the portable owner before any physical schema is
chosen.

## Package And Dependency Boundary

The final deliberate private subpath is:

```text
@flarex/query-sync/internal/transition-plan
  -> packages/query-sync/src/transition-plan/index.ts
```

The domain-specific name `transition-plan` is intentional. This is not a
generic transaction planner, CRUD library, or reusable database abstraction.

Source modules may be created during D1, but the package export is withheld
until D4 completes all nine operations and the all-operation proof. A partial
planner family must not become adapter authority.

The dependency direction is:

```text
canonical/domain values and shared receipt facets
                         |
                         v
             transition-plan policy
                         |
            +------------+-------------+
            |                          |
            v                          v
 aggregate compatibility/oracle   future host adapter
 wrappers and reference tests      after a fresh gate
```

The transition-plan boundary must not import or expose:

- `QuerySyncState`, `buildQuerySyncState`, or `rebuildQuerySyncState`;
- SQL, table, column, index, driver, cursor, or transaction types;
- Cloudflare, Durable Object, Workerd, Flarex, or Postgres types;
- Effect runtime, `Clock`, `SynchronizedRef`, `Context`, `Layer`, or `Scope`;
- arbitrary read/write callbacks, generic CRUD, or an aggregate-save API;
- host integration errors, storage generations, or physical scope fences; or
- a second clock, source, evaluator, publisher, or authorization owner.

The existing package remains private, keeps no root export, gains no package
or dependency split, and retains `./internal/kernel` for aggregate
compatibility/oracle APIs and `./internal/state` for the state port and its
integration contract. Test-only normalized plan interpreters remain under a
testing subpath.

## Pure Planner Contract

The common semantic shape is equivalent to:

```ts
type TransitionPlan<Receipt, Expectation, Change> =
  | Readonly<{
      readonly _tag: "noWrite"
      readonly receipt: Receipt
    }>
  | Readonly<{
      readonly _tag: "write"
      readonly receipt: Receipt
      readonly expected: Expectation
      readonly nextScope: QuerySyncScopeFacts
      readonly change: Change
    }>
```

`QuerySyncScopeFacts` contains the cursor, evaluation revision/fairness state,
and all eight exact state metrics. Operation-specific facts separately carry
only the required query, dependency, completion, or publication neighborhood.
For ordinary transitions, `Expectation` contains the exact expected scope and
operation neighborhood. Initialization instead uses an exact presence
expectation, so an authorized fresh-absence write does not pretend a prior
scope exists.

Every operation owns closed `Expectation` and `Change` types. The expectation
contains exact before/presence compare facts; the change contains exact next
domain facts for the affected slots. Neither is a table-shaped mutation array.
Their collections have canonical deterministic order for equality and proof,
but they do not dictate a physical SQL statement order. A host translates the
one atomic domain change into a safe physical write sequence inside its own
transaction.

The planner explicitly says `noWrite` or `write`. Commit behavior must never be
inferred from a receipt tag, aggregate object identity, or before/after value
equality. In particular:

- a replayed begin may coalesce a newer dirty frontier and therefore write;
- claiming an existing ready provisional records the fairness anchor and is a
  write even when the selected key equals the prior anchor; and
- a fresh publication claim is one write containing both removal from pending
  and installation as in-flight.

Failure returns no plan and no mutation. Planners use the installed Effect v4
`Result` for recoverable typed outcomes. They are not Effects and acquire no
capability or resource.

## Fact Families And Value Ownership

The shared fact vocabulary is deliberately scalar-first:

- **scope facts:** cursor, evaluation work revision, fairness anchor, and exact
  metrics;
- **query scalar facts:** complete descriptor, active scalar fields without
  dependency arrays, provisional state, completion scalar fields without
  completion dependencies, and preceding completion identity;
- **query dependency facts:** exact active and completion dependency sets plus
  the generation that owns each set;
- **evaluation scan facts:** query key, provisional generation and ready or
  blocked disposition, and nullable active dirty frontier;
- **publication facts:** exact pending or in-flight publication plus the
  smallest owning-query integrity projection; and
- **publication lifecycle facts:** in-flight, latest-delivered, preceding
  outcome, without the complete pending collection. Settlement exists only as
  `settlementEnvelopeBytes` in scope metrics; there is no separate settlement
  state or fact row.

Passing the current `QueryState` to every planner is rejected because it
embeds both dependency arrays and would force unrelated reads. Passing a
complete publication collection is rejected for the same reason.

Adapters decode unknown storage rows and establish owned immutable fact
values before calling the core. The core validates canonical order,
uniqueness, bounds, generation links, and cross-fact coherence. It copies and
freezes values it retains or returns; it does not recursively freeze
caller-owned input and does not introduce a universal deep-freeze helper.

## Staged Read Protocol

Some decisions require a cheap first decision followed by a bounded indexed
read. They use a closed step protocol equivalent to:

```ts
type TransitionStep<Plan, Intent, Resume> =
  | Readonly<{ readonly _tag: "planned"; readonly plan: Plan }>
  | Readonly<{
      readonly _tag: "read"
      readonly intent: Intent
      readonly resume: Resume
    }>
```

An intent names domain facts, not storage mechanics. A resume value is frozen,
nominal, issued by the matching planner in the current process, and accepted
only by that operation's named resume function. Issuance uses the same
capability discipline as existing evaluation continuations and attempts. A
resume is never serialized, reconstructed, returned to a client, or resumed in
a later transaction.

All stages execute synchronously under one host-owned serialized
transaction/snapshot. No stage token, driver cursor, transaction handle, or
partially decoded row set may escape or cross an `await`.

The intent interpreter must guarantee complete range, point, and reverse
lookup results. Core can prove order, uniqueness, limits, and row coherence;
it cannot prove that a host silently omitted a matching row. Omission is an
adapter defect or stored-state corruption, never semantic `none`, `blocked`,
or an incomplete invalidation receipt. Physical uniqueness must also prevent a
`DISTINCT` query from hiding duplicate or orphan membership rows.

## Operation Plan Matrix

| State operation | Planner/read shape | Atomic semantic result |
| --- | --- | --- |
| `initializeOrInspectNamespace` | One-shot over an explicit presence union | Inspect without writing, or install one exact empty scope and durable initialized-history intent. |
| `beginQueryEvaluation` | One-shot over scope and target query scalars | No-write decision or exact query/provisional, revision, and metric replacement. |
| `applyAdmittedBatchAndAdvance` | Staged: sequence decision, reverse membership lookup, affected active point reads | Cursor advance, dirty-frontier replacements, optional revision bump, and exact metrics. |
| `completeQueryEvaluation` | Staged: scalar decision, then only replay or mutation neighborhood facts | Query/completion/dependency replacement plus optional pending publication, revision, and metrics. |
| `claimEvaluationWork` | Staged: request/fence, slim cyclic page, selected-query point read | No work/continuation/restart, fairness-only claim, or provisional creation plus revision and metrics. |
| `recordEvaluationAttemptOutcome` | One-shot over scope and target query scalars | No-write outcome or exact blocked disposition, revision, and metrics. |
| `claimPublication` | Staged: in-flight plus exact owner first, otherwise lowest pending and its owner | Replay/block/none, age-block lifecycle update, or atomic pending-to-in-flight claim. |
| `recordPublicationAttemptOutcome` | One-shot over lifecycle, owner, attempt, outcome, and one instant | Replay/refusal or exact ordinal/disposition/preceding-outcome and metric replacement. |
| `completePublication` | One-shot over lifecycle, owner, and acceptance evidence | Replay/supersede or clear in-flight, set latest-delivered, and replace metrics. |

The state port method remains `applyAdmittedBatchAndAdvance`; existing kernel
errors continue to identify the semantic operation as
`applyAdmittedInvalidations`. QSYNC01-D does not opportunistically rename that
observable internal contract.

## Exact Staging Rules

### Apply an admitted batch

The first stage preserves this order:

1. classify namespace, model, epoch, and sequence;
2. finish `duplicate`, `gap`, or `resetRequired` without another read;
3. only for exact-next, enforce the 65,536 dependency-lookup ceiling; and
4. request the complete distinct affected active query-key set with one
   limit-plus-one sentinel.

An oversized duplicate therefore remains `duplicate`, not a work-limit error.
More than 4,096 affected queries fails with observed `4_097`. Zero matches
plans only the cursor advance. Otherwise a second intent reads exactly the
affected active scalar facts. The final write:

- advances the cursor in every exact-next case;
- updates each dirty frontier behind query-key, generation, and old-frontier
  compare facts;
- bumps revision only for a nonempty affected set;
- preserves the fairness anchor and all dependency rows; and
- returns affected query keys in canonical order.

The same committed batch is classified as duplicate before any dependency read
on replay.

### Complete an evaluation

The first stage reads only scope and target scalar facts and resolves every
branch that does not require retained dependency or publication evidence.

- An exact replay requests the completion dependency fingerprint and only the
  exact retained publication needed to validate replay.
- A material completion requests old active and completion dependency sets,
  the target query's pending publication, and only the publication lifecycle
  neighborhood needed to validate cross-links.
- Superseded, expired, refresh, resnapshot, and rerun outcomes stop without
  unrelated reads or writes.

The final write atomically replaces active and completion state, clears the
provisional, moves the prior current identity to preceding, replaces both
dependency roles, optionally replaces the query's pending publication, bumps
revision, and replaces metrics. It never removes in-flight publication work.

### Claim evaluation work

The start stage preserves existing failure order:

1. validate the inspection request;
2. authenticate a non-null nominal continuation;
3. validate namespace, model, and epoch;
4. compare revision and scan-start anchor with current scope; and
5. return `scanRestarted` without a scan when that fence is stale.

The page intent returns slim facts only. Canonical cyclic order remains keys
above the anchor, then keys at or below it, with the anchor last. Eligibility
precedence remains ready provisional, blocked provisional evidence, dirty
active only when provisional is absent, then clean.

For a resumed scan, the intent returns a slim `revalidationPrefix` from the
scan origin through the last inspected key plus the new page and `hasMore`.
The combined unique rows never exceed 4,096. Core recomputes the prior wrap and
lowest-blocked evidence before consuming the page. This preserves current
malformed-crossing detection without loading query identities. Removing that
revalidation is a later explicit semantic change, not a D optimization.

Once a candidate is found, a point intent reads its complete descriptor and
attempt facts. Core compares those facts with the slim candidate fingerprint.
A missing or crossed point fact in the same snapshot is corruption or defect,
not a new scheduling decision.

A ready provisional claim changes fairness and exact metrics without changing
revision. A dirty active claim creates the successor provisional, changes
fairness, bumps revision, and updates metrics. There is intentionally no exact
claim replay lease; a lost response starts a later turn from current durable
state.

### Claim publication work

The serialized state owner captures one `PublicationAttemptInstant` and passes
it to the pure planner. The first read examines in-flight state before pending
selection. When in-flight work exists, the planner emits an exact owner-query
point intent and validates identity, generation, query identity, and cursor
relationships before returning replay, blocked, or a single age-block update.
Only absence of in-flight work requests the lowest pending publication in
canonical `(queryKey, generation)` order and its owner query.

A fresh claim is one atomic change that removes pending and installs in-flight
with ordinal `1` and the captured first/last instant. Publication completion
later clears in-flight and sets latest-delivered; it never deletes pending
because claim already performed that move.

## Accounting And Limit Authority

One pure internal accounting owner is extracted from the aggregate builder and
shared by every planner. It owns exact contribution functions for:

- cursor and scope/evaluation-work base state;
- query descriptor and scalar slots;
- active dependency memberships;
- completion-fingerprint dependency values;
- pending and in-flight publication content;
- latest-delivered and preceding-outcome lifecycle values; and
- the publication settlement envelope.

Every write plan carries complete expected and next metrics for all eight
fields:

```text
queryCount
retainedIdentityBytes
dependencyMemberships
pendingPublicationCount
inFlightPublicationCount
retainedPublicationContentBytes
settlementEnvelopeBytes
countedCanonicalBytes
```

Planners calculate replacement contributions from exact before/after facts.
Adapters compare and persist the planner result but never calculate a semantic
delta. The aggregate builder uses the same contribution functions while
performing its complete oracle scan.

A decoded scope metric is admitted authority for every untouched contribution
during an operation. The later adapter must establish exact counters at
creation/migration, preserve them with compare-fenced writes, and reject any
declared read-set mismatch. A planner does not rediscover arbitrary corruption
in unrelated rows; a future bounded audit is a separate gate.

The current aggregate builder can report a traversal-dependent first-crossing
subtotal for `countedCanonicalBytes`. Bounded planners cannot reproduce that
subtotal without unrelated rows. D intentionally replaces it with one exact
final-metric validator. When several portable maxima are exceeded, it checks
this fixed priority:

1. `queryCount`;
2. `retainedIdentityBytes`;
3. `dependencyMemberships`;
4. `pendingPublicationCount`;
5. `retainedPublicationContentBytes`; and
6. `countedCanonicalBytes`.

The reported `observed` value is the exact final metric, not an intermediate
subtotal. Existing error tag, dimension, maximum, and the current private
`operation: "buildQuerySyncState"` spelling remain unchanged. This narrow
compatibility amendment must have explicit multi-overflow and input-order
tests. Every other operation-specific validation and first-failure order
remains unchanged.

In-flight cardinality and settlement-envelope integrity remain invariant
checks represented by their exact metrics rather than new state-limit
dimensions.

## Invariant And Error Boundary

Local invariant policy is decomposed alongside accounting:

- query scalar invariants;
- active and completion dependency-set invariants;
- publication-to-query invariants;
- publication lifecycle-neighborhood invariants; and
- portable metric and work-limit validation.

The planners return expected domain failures through `Result`. An internally
consistent but unsuccessful operation has no plan. A decoded fact bundle that
is intrinsically invalid or mutually inconsistent uses one private typed
`QuerySyncTransitionFactError` with operation and stable reason, without raw
row values or host causes.

A future durable adapter translates an admitted transition-fact error into its
stored-state corruption contract. An aggregate compatibility wrapper treats
the same error as `QuerySyncInvariantDefect`, because facts projected from a
successfully built aggregate must already be coherent. A successful plan whose
metrics disagree with full aggregate reconstruction is also an invariant
defect. It is never downgraded to an ordinary capacity, contention, or retry
failure.

Raw row decoding, storage generation, physical compare/write row counts,
driver failure, and commit certainty remain host concerns. Expected failures
are not thrown. Unexpected defects retain their Cause when later lifted into
Effect.

Initialization has a separate private policy-error union because its admitted
presence and binding evidence are not aggregate facts. It distinguishes:

- bootstrap/binding mismatch;
- absence after durable prior initialization; and
- present namespace/binding mismatch.

The state adapter maps those exact reasons respectively to the existing
`bootstrapBindingMismatch`, `aggregateMissing`, and
`namespaceBindingMismatch` integration errors. Model and epoch replacement
remain receipt outcomes. This mapping is shared by the reference store and
conformance harness; initialization policy errors are not converted to
aggregate invariant defects and the planner still imports no host error type.

## Initialization Authority

Initialization is a first-class shared planner. Its input is an explicit
presence union, not a Boolean:

- externally authorized fresh absence;
- absence after durable prior-initialization evidence; or
- present scope facts.

The planner consumes fresh-initialization authority; it never mints or
authenticates it. Only authorized fresh absence can create exact empty scope,
revision, fairness, publication lifecycle, metrics, and durable initialized
history. Prior initialized absence is corruption. Present scope inspection is
read-only and returns the existing/model-replaced/epoch-replaced outcome.

Both the reference state store and state conformance harness must delegate to
this planner. Their current duplicate initialization reducers are removed.

## Receipt And Compatibility Ownership

There must be one state-free semantic outcome and receipt owner. Planner
results and existing aggregate decisions share those exact facets; aggregate
decisions add only their complete next state. The existing
`@flarex/query-sync/internal/state` receipt names and runtime shapes remain
compatible reexports/projections rather than a duplicated union family.

The current aggregate reducer functions remain available through
`./internal/kernel` while D is private. Each becomes a compatibility/oracle
wrapper that:

1. projects the declared bounded facts from an owned complete aggregate;
2. calls the sole operation planner and completes any staged reads in memory;
3. applies the operation-specific logical change to owned aggregate parts;
4. calls the complete aggregate builder as a global invariant oracle;
5. requires rebuilt metrics to equal the plan's exact next metrics; and
6. returns the existing state-bearing decision shape.

The package-local aggregate applicator returns an internal
`{ decision, disposition }` result, where disposition is exactly `noWrite` or
`write`, and retains the originating plan for assertions. Existing exported
aggregate functions project only the unchanged decision contract;
`ReferenceStateStore` uses the same applicator result so it can obey the
disposition without deriving it from state identity.

The old semantic branches are deleted as each operation moves. No
`LegacyReducer`, copied test reducer, shadow path, fallback, or long-lived dual
comparison remains. `QuerySyncState`, aggregate find helpers, and the complete
builder survive only as reference/oracle representations.

`ReferenceStateStore` keeps serialized `SynchronizedRef` ownership, binding
validation, receipt projection, Effect integration errors, clock capture, and
before/after-swap fault injection. It uses the plan's explicit write/no-write
disposition instead of `decision.state !== state`.

## Effect, Transaction, And Clock Boundary

The planner is local, lifecycle-free pure policy. It does not justify a
Context tag, service, Layer, Scope, or nested Effect runtime.

The reference adapter captures `Clock.currentTimeMillis` inside its existing
serialized state modification and converts it once to
`PublicationAttemptInstant`. A future SQLite adapter separately reads one
validated database instant synchronously inside its transaction. The planner
accepts that instant and never calls `Date.now` or Effect `Clock`.

A later synchronous transaction callback performs decoded reads, planner
steps, compares, and writes. It may return a `Result` value. Only after the
callback exits does the host enter or flatten the Effect error channel. It
must not invoke `Effect.runSync`, create a runtime, or execute asynchronous
Effect work inside the transaction.

Before-swap retry may observe a later reference clock instant. After-swap
response loss must replay the persisted publication ordinal and instant.

## Required Equivalence And Proof

Each D code gate must prove more than existing shared-reducer conformance. The
final proof matrix is:

| Proof family | Required evidence |
| --- | --- |
| Characterization | Every current branch preserves failure class/fields, receipt fields and enumerable keys, decision order, next state, and no-write behavior except the explicit final-metric amendment. |
| Independent plan interpretation | Project bounded facts, invoke the planner, apply its change through a normalized test-only interpreter, rebuild the complete aggregate, and compare receipt plus complete state with the compatibility wrapper. |
| Noninterference | Equal declared facts and counters with different unrelated equal-cost rows produce the same plan. |
| Bounded staging | No aggregate type enters planner modules; terminal early decisions request no later stage; intents contain exact keys, canonical order, limits, and limit-plus-one refusal. |
| Accounting | Every write plan's eight next metrics equal the complete rebuild; exact maxima pass and plus-one fails before a mutation exists. |
| Replay | Every replayable command is repeated, including write-bearing replay/coalescing and fairness branches. |
| Ownership | Inputs remain unchanged; retained outputs are owned/frozen; nominal resumes, attempts, and continuations cannot be forged or reconstructed. |
| Faults | Every write variant proves before-swap `notCommitted`, after-swap committed state plus unknown outcome, and correct replay; failure/no-write variants never trigger a swap fault. |
| Concurrency | Competing initialize, begin, apply, evaluation, completion, and publication commands equal one complete enumerated serial history. |
| Generated histories | Extend the existing deterministic generator across all nine operations and compare receipt plus complete state after every command, without a new property-testing dependency. |
| Boundary audit | Exact final export map, no root export, no forbidden dependency/import, no host types, and no aggregate import in transition-plan modules. |

Once aggregate wrappers and the reference state adapter share planners,
reference conformance proves adapter serialization and projection, not an
independent second semantic implementation. The normalized plan interpreter
and full aggregate reconstruction are therefore mandatory. The interpreter is
test-only and cannot become a production adapter or copied reducer.

Existing targeted policy, recovery, selection, publication, fault,
concurrency, receipt-isolation, and deterministic-seed suites remain
characterization evidence. D extends rather than weakens their assertions.

## Implementation Gates

### `QSYNC01-D0` - architecture freeze

Complete with this docs-only record. It accepts the boundary, staged protocol,
accounting/error decision, proof matrix, and ordered code slices. It implements
nothing.

### `QSYNC01-D1` - foundation, initialize, begin, and apply

The first proposed medium code slice will:

- add the shared fact, plan, nominal resume, receipt-facet, accounting, limit,
  and local-invariant foundations;
- implement initialization and `beginQueryEvaluation` planners;
- implement the first staged planner for `applyAdmittedBatchAndAdvance`;
- convert the corresponding aggregate APIs into planner-backed wrappers;
- remove both duplicate initialization policies;
- make reference swap behavior follow explicit write/no-write plans; and
- prove direct equivalence, replay/coalescing, staging bounds, metrics, faults,
  concurrency, ownership, and deterministic histories for those operations.

D1 adds no package export and no backend, schema, or host code. Its inclusion
of apply is deliberate: the first slice must prove the staged-read architecture
rather than defer its principal risk.

### `QSYNC01-D2` - evaluation completion

Move `completeQueryEvaluation` alone. This isolates the largest cross-family
atomic plan: active/completion replacement, two dependency roles, retained
replay evidence, pending publication intent, revision, and counters.

### `QSYNC01-D3` - evaluation selection and outcome

Move `claimEvaluationWork` and `recordEvaluationAttemptOutcome`. Replace the
aggregate scan with the accepted slim revalidation-prefix/page protocol and
selected-query point read. Prove revision fencing, fairness, wrap, lowest
blocked evidence, continuation authenticity, stale restart, and both claim
mutation forms.

### `QSYNC01-D4` - publication lifecycle and all-operation exit

Move `claimPublication`, `recordPublicationAttemptOutcome`, and
`completePublication`. Prove state-owner clock inputs, pending-to-in-flight
atomicity, age/ordinal blocking, outcome replay, completion, all publication
counter transitions, and the complete nine-operation generated/concurrency
matrix.

Only after the all-nine proof passes may D4 add the final
`./internal/transition-plan` package export. Completion of D4 still does not
authorize SQLite. It permits a fresh `QSYNC-FX01-C1` discussion checkpoint.

Each code gate requires its own explicit approval and significant-diff review.
A completed earlier D slice does not authorize a later one.

## Validation And Review Gates

Every D implementation checkpoint must run:

- `pnpm --filter @flarex/query-sync typecheck`;
- focused new and affected tests, then the complete package suite;
- `pnpm lint:core` and `pnpm lint:diff`;
- forbidden import, dependency, aggregate-type, and export-map audits;
- `git diff --check`;
- both standing TypeScript and code-quality final-diff reviewers; and
- `pnpm lint:diff -- --staged` against the exact final index.

The TypeScript review must apply the repository's Effect, typed-error, value
ownership, and runtime-boundary guidance. Real PostgreSQL and Workerd receipts
are not required for D because D changes only the portable/reference package.
They remain mandatory at their later adapter gates.

## Explicitly Not Authorized

This accepted preflight does not authorize:

- D1, D2, D3, or D4 implementation without a separate approval;
- a public API, package-root export, new workspace package, or new dependency;
- SQLite DDL, indexes, migration, storage generation, dual tables, aggregate
  blob, compatibility write, shadow reducer, or backend adapter;
- a generic transaction/read/write/save API or SQL-owned semantic decision;
- Postgres source admission, evaluator, publisher, delivery stream, gateway,
  client SDK, route, alarm, wake, or production caller;
- release, eviction, reconciliation, or reset transitions outside the existing
  nine-operation state port;
- OCC, commit, journal, idempotency, authoritative-row, retention, or
  transactional-outbox changes; or
- runtime portability, `R03-B`, `SV-R Live`, or production-readiness claims.

## Next Checkpoint

The next proposed action is an explicit approval or rejection of
`QSYNC01-D1`: the shared transition-plan foundation plus initialization,
begin, and staged admitted-batch application. Until D1 is approved, there is
no code slice. Until D1-D4 all complete, there is no FX01 SQLite slice.

`QSYNC-CF01` remains a separate delivery feasibility/selection gate and does
not change this ordering.
