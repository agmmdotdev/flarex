# Shared Application owner and standalone queries

Status: **Bounded fresh query/mutation owner implemented; broader native,
managed-host, cache and source-parity gates remain open**. Independent
current-owner, pinned-source and accepted-direction challenge plus peer exchange
are complete.
Baseline: Flarex 22930f93cdbb08f7876145ec692ddb6df44b1d62; Convex
db914cf06e2b06ee985646611b9e12ed7a770318. Follow the [goal](../GOAL.md),
[replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow),
[fresh mutation cutover](./06a-application-persistence-cutover.md) and
[SDK query translation](./06b-application-sdk-queries.md).

## Connected outcome

Execute standalone public Application query functions and the existing fresh
mutations through the same portable database owner and canonical app Durable
Object. Replace the old private query-only DO composition; do not put the old
SQL-command serving graph behind a new core facade. Reuse current Analysis,
source/manifest validation, the actual isolated Worker, SDK, public invocation
facades and sound PostgreSQL resource owners.

The source contract begins a query at the ready owner's local published
timestamp S, validates its program and arguments in that selected view, executes
with read-only capabilities, validates the return and consumes its read operation
without settlement. A query admitted at S may return S after a mutation publishes
S+1. New ordinary calls must reach the current owner and include previously
acknowledged publications. Nested queries borrow the parent's operation, time,
deadline and accounting; they do not begin a new snapshot.

## Independent challenge and resolved findings

The current-owner, source and accepted-direction agents inspected independently,
then exchanged counterexamples and source evidence. Their conclusions converge:

| Finding | Selected disposition |
| --- | --- |
| Every openCoreDatabase acquires a lease and creates resident publication state. | One owner opens once per app lifetime. Query and mutation borrow that owner; no independent query database or request-scoped bootstrap. |
| Core selectProgram and later begin intentionally support fixed mutation identity, but do not atomically select query program/data at S. | Add query entry at the snapshot/registry owner. Metadata, visibility, arguments, tables and indexes use that same selection. Preserve the captured program through head publication. |
| Fresh program preparation is mutation-specific and installed only by test consumers. | Put shared verified program production/selection at its existing production owner, consume genuine current Analysis and support query kind directly. Do not encode queries as mutation authority or copy this algorithm into fixtures. |
| Source queries consume into a read token and never claim/commit an outcome. | Add a consumptive read-only completion owning S and exact dependencies. No durable query request, claim, outcome or empty commit. Nested borrowers cannot finish the parent operation. |
| Current query DO uses request-owned legacy serving and old cache handoff. Its only callers are its host fixtures. | Replace that DO composition and migrate those actual-host witnesses. Retain lower legacy query/evaluation services only for named remaining consumers. |
| The mutation host already owns stream handles, serial RPC admission, failure Causes and drain. | Extract/reuse one read-session mechanism for query and mutation, preserving whole-terminal tracking and trusted capability boundaries. |
| A held old query refuses an otherwise identical head republish. | Replace this obsolete comparison for the fresh target under the accepted grant-authority direction. Genuine function selection, authentication, deadlines and applicable grant revocation keep their own enforcement. |
| SQL lease fencing protects writes, not an obsolete resident reader. Source PostgreSQL explicitly permits stale reader processes. | Use canonical app routing and complete supported writer closure under the [DO ownership adaptation](../divergences/single-app-owner-routing.md). A polling interval or per-query timestamp SQL is not a freshness proof. |
| DO shutdown has no guaranteed destructor and old in-flight calls can outlive replacement. | Gate new admission through the canonical instance; fence old writes before bootstrap. Do not depend on a shutdown hook to reconcile outcomes. Controlled maintenance closes/drains the owner before reconstruction. |
| Translated observations are transaction-local; the old target's cross-query cache is not reusable unchanged. | Keep result-cache/shared-handoff activation out of this slice, with its full writer/fill/retention gates still open. Do not claim warm-cache SQL avoidance or a measured speedup. |

## Ownership, readiness and writer closure

Bind one trusted app identity, physical target, instance and cursor-secret
identity in host configuration. Requests cannot select the target, DO identity,
SQL, program metadata, source, grants or finalizer. All public calls resolve the
same canonical app stub; another name/unique ID must fail before database open.
Keep the host adapter above both portable persistence and Standard invocation;
no Cloudflare imports enter core logic.

Owner startup acquires the PostgreSQL fence, completes safe bootstrap and builds
the resident registry/committer before admission. Keep the existing bounded save
configuration explicit; this slice does not close the wider overlapping-save or
group-commit milestones. Opening/failed/closing owners do not admit calls.
Every borrowed session owns cleanup and blocks callbacks/results after its own
closure or fatal loss. No SQL transaction spans user execution.
Unreturned contexts are disposed on failure, defect and interruption; only
successful query/mutation handoffs retain a live borrow.

Supported fresh data writes, install/program/index/schema changes,
advanceAuthorityEpoch, request claims/recovery/abort and settlement go through
this same CoreDatabase. Initial setup occurs before activation with its old
owner drained. Direct fixture persistence/SQL ports remain lower-owner failure
injection or observation tools, outside the app host/user capabilities. External
lease acquisition or raw metadata maintenance while a live canonical owner
serves is unsupported; supported maintenance uses a close/fence/reconstruct
barrier. This is a concrete caller/target closure requirement, not a claim that
PostgreSQL prevents an administrator from issuing arbitrary SQL.

Recover committed-but-unacknowledged mutations through the existing correlated
outcome owner under the newer fence before another body is eligible. Same-owner
active claims remain busy. A shutdown/restart, cancelled task or immediate query
does not prove rollback. Do not add a second recovery state machine.

## Query authority and lifetime

Standalone queries keep the existing anonymous/default or established identity
profile; they do not acquire a mutation grant or durable request identity.
Capture/validate identity at the trusted boundary. Application permission reads,
program visibility and metadata are tracked at S. Separate grant-bearing parent
mutation calls retain their actual epoch/deadline checks during nested queries.
Do not invent a grant protocol to make code reuse easier.

The trusted query entry captures the operation and program coherently. Resolve
source and validators from verified current metadata, execute mode=query, expose
only the supported get/query and nested read calls, and validate results before
disclosure. Reuse the current SDK compiler/cursors, per-operation quotas and
transport limits. Drain admitted terminals, reject late starts and close every
stream before completing or abandoning the read operation. Preserve full Causes,
cancellation and precise ordinary query refusals.

Query-to-mutation is refused; nested queries remain at the parent's S. The
captured nested-call catalog includes both public and internal functions, as the
supported SDK reference types and pinned runUdf require. External invocation
still enforces public visibility; do not narrow a public nested-call witness to
an internal-only helper to preserve the old runtime mismatch.
The read-only finish enforces the absence of writes and consumes the operation into
its trusted timestamp/read-set token. It cannot be committed. Do not manufacture
legacy CommitSeq, located authority or old evaluation receipts from this token.
Real legacy task, relation, scope-sync and native consumers remain named migration
inputs until their own connected replacement.

Existing internal ID normalization remains with core and argument validation.
This slice adds no public SDK normalizeId method; that absent surface requires
its own source-compatible synchronous contract and dependency design.

## Coordinated implementation

- Core/program owner: coherent query entry, consumptive read completion, shared
  verified metadata/producer and core/mutation-port adaptation; owner both-driver
  scenarios. Publish the typed contract before dependent edits.
- Invocation owner: shared read-session extraction, standalone Standard query
  composition, nested read-only execution and current Worker contract if needed.
  Preserve the current fresh mutation profile and legacy consumers.
- App host owner: canonical configured app DO, stable owner/resources and both
  query/mutation entrypoints; replace the displaced query-only host and actual
  workerd/socket witnesses after the portable contracts are published.
- Consumer owner: genuine cold Analysis/source registration, shared fresh setup,
  public invocation and coherent nested/metadata/lifecycle regressions on PGlite
  and ordinary PostgreSQL; fixtures use owning producers rather than duplicate
  core behavior.
- Coordinator: contract handoffs, source hashes/divergences, shared exports and
  manifests, scoped clean projection, actual-host integration, review and commit.

Workers share the checkout and preserve unrelated changes. The new baseline
snapshot is external to the repository; partial staging must retain old Standard,
Task and generated-source work. Reviewers remain read-only.

## Required witnesses and remaining gates

Prove public typed runQuery and current cold Analysis/Worker execution; read-only
and nested capability refusal; fixed metadata/data/time across awaits and nested
calls; all SDK terminals and cursors; exact point/absence/consumed-range evidence;
no durable query claims/outcomes/publications; whole-terminal drain and cancellation.
After an acknowledged mutation, a new query sees it through the same owner;
an earlier S-query stays coherent. Republish a program/head during a query and
verify later calls select current metadata while the old call keeps S.

Actual workerd/DO tests must cover canonical identity and wrong-ID refusal,
concurrent callers sharing owner state, bootstrap readiness, PostgreSQL socket
lifetime, mutation then query, cold/restart reconstruction, stable cursor secret,
fenced old writes and uncertain-ack replay without another body. Distinguish
local runtime/reset evidence from managed Cloudflare replacement behavior; a
sequential fixture close/reopen alone is not a stale-read routing proof.

Run affected typechecks, both database lanes, source/compatibility guards,
generator checks and lint, then both required project reviews. Retire displaced
fresh construction, tests/exports and the unreferenced old query-only DO in this
scope. No named durable-data reset or production route is authorized here.
Preserve instance/document/index identities across the tested host migration.
Full staged installation/builders, populated migrations, native adapters, shared
caches/reactivity, retention/GC, broader commit pipelining and complete-request
capacity remain goal gates.

The current kernel's acyclic nested-call profile remains selected by
[roadmap 49](../../../../roadmaps/49-application-analysis-migration.md). It is
explicitly narrower than the pin's depth-bounded recursive calls. Identity
propagation is witnessed with distinct parent/child functions; no recursion
support is claimed. Translating this remaining call-profile difference is a
separate goal item, not a demonstrated DO limitation or permanent source-parity
exception.
