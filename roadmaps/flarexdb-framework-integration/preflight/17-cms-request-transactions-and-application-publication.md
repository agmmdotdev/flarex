# CMS Request Transactions And Application Publication

## Status And Outcome

Status: concrete proposal for the private CMS host and Application
commit-participation capability. Implementation is not yet accepted. The
post-core Application-preservation gate is complete on PGlite and ordinary-role
PostgreSQL 18; its maintained proof inventory is below.

The next usable outcome is a bounded scalar CMS command that reads its pending
Application documents and publishes exactly one Application commit, result,
change set and wake. A failing nested operation rolls the entire command back.
This requires the separately accepted Application write-policy capability before
any CMS-owned table can be written. It does not admit a Payload adapter, arbitrary
hooks, native relation mutation, commerce facts, public APIs or production use.

## Application Preservation

The following complete existing scenarios qualify the current Application
document/OCC/relation/commit/read vertical after shared-core receipt work:

| Existing scenario | Preserved behavior |
| --- | --- |
| [Application-native mutation](../../../packages/system-test/test/integration/applicationNativeMutation.test.ts) and its [PostgreSQL counterpart](../../../packages/system-test/test/integration/applicationNativeMutation.postgres.test.ts) | Active selection, candidate write authority, exact replay, conflicting request keys, concurrent duplicates, OCC rerun, head movement, terminal failures and matching commit/result/feed/outbox counts |
| [Application-native query contract](../../../packages/system-test/test/contracts/applicationNativeQueryContract.ts), through both native-query driver files | Active snapshot, fresh Worker execution, point reads, revalidation and selecting a moved active head |
| [SV-R Core](../../../packages/system-test/test/integration/applicationRelationalCore.test.ts) and its [PostgreSQL counterpart](../../../packages/system-test/test/integration/applicationRelationalCore.postgres.test.ts) | Definition/analysis, readiness/activation, runtime mutation, missing relation authority refusal, put/reorder/remove/retarget/restrict/delete, row history, adjacency versions, R03-A facts and RQ01 |
| [RQ01](../../../packages/system-test/test/integration/applicationRelationQuery.pglite.test.ts) and its [PostgreSQL counterpart](../../../packages/system-test/test/integration/applicationRelationQuery.postgres.test.ts) | Exact relation identity and paging, stale/missing authority refusal, read-only state preservation and snapshot-bound dependency evidence |

The manifest-owned commands are:

```sh
node scripts/run-test-lane.mjs framework-application-preservation-pglite
node scripts/run-test-lane.mjs framework-application-preservation-postgres
```

The PostgreSQL command requires `FLAREX_POSTGRES_DATABASE_URL` for the ordinary
test role. Run the two Worker-backed lanes serially, with one isolated file at a
time. Keep their existing shared scenario helpers, fixtures and assertions; do
not repeat these verticals for every pure receipt validation case. These lanes
cover the complete named vertical, not every package test, Action/Task, hosted
Cloudflare, reconnect/live sync, Payload or Medusa conformance.

No Application runtime, journal, schema, row, relation or publication source was
changed to obtain this preservation result. Future shared publication changes
must pass these same lanes again plus focused fault and concurrency tests at the
changed boundary.

## Current Source And Required Boundaries

| Current owner | Finding and disposition |
| --- | --- |
| [Application mutation admission](../../../packages/persistence-postgres/src/applicationMutationAdmission.ts) | Selects a published Application function and its active authority. Keep it for Application invocation; a CMS operation must not impersonate a function or mint a Worker grant. |
| [Application query snapshots](../../../packages/persistence-postgres/src/applicationQuerySnapshot.ts) | Opening an ordinary snapshot requires a published public query function. Reuse underlying document/snapshot validation through a CMS-owned admission facade; do not fabricate a query function to call this facade unchanged. |
| [Scope execution](../../../packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts) and [scoped operations](../../../packages/persistence-postgres/src/scopeExecution/ScopedTransaction.ts) | Own scope-first locking and opaque registered operations, but remain Application-operation-shaped. Share owned mechanisms without exposing `AppRowTransaction` to adapters. |
| [Application row persistence](../../../packages/persistence-postgres/src/appRows.ts) | Owns revision chains, creation time and current-head CAS. Append-only history is not a mutable framework row store; repeated edits in one request need a bounded pending document representation before materialization. |
| [Point commit transaction](../../../packages/persistence-postgres/src/pointCommitTransaction.ts) | Its kernel validates session/journal/OCC evidence and maintains rows, indexes, uniqueness and relations. Its publication tail writes header, facts, result and wake, then deletes the journal/lease, commits the session and advances the scope clock. These responsibilities cannot all be handed to CMS unchanged. |
| [Receipt collection](../../../packages/persistence-postgres/src/commitPublication/collection.ts) | Establishes private exact-set authentication and single-use closure for reserved scalar SQL. Preserve that rejecting family. A CMS Application materialization needs its own issuer; scalar relational tokens do not become Application-row authority. |

The [execution-profile decision](./14-transaction-execution-profiles.md) and
[pinned Payload audit](./07-payload-release-and-adapter-contract.md) retain their
authority. This proposal resolves the latter's standalone-read gap for the
first bounded profile; it does not broaden its supported feature matrix.

## Admission And Session Ownership

The composition root registers fixed trusted operations before serving work.
The private CMS host receives an authenticated CMS binding, deployment/scope
authority, registered operation identity and captured input. It resolves the
exact Application projection, active head, readiness, owner/table set, placement,
generation and write-policy evidence. A string table name or a Payload request
object alone never grants authority.

Use one actual target transaction per outer command. Preserve scope-clock
locking before target binding/availability and downstream Application metadata
or row locks. Validate all pins on that transaction before entering the command;
keep the accepted availability and write-policy evidence stable through final
admission. A split control store supplies authenticated evidence; it is not a
second data transaction that may partially commit content.

The adapter-facing request ID is an owned nonblank opaque string, resolved only
within this host's private registry and exact request identity. It is a locator,
not a transferable bearer capability. Adapter operations also require the outer
admitted request context, which survives deletion of `req.transactionID`.

- `begin` joins the exact live request or creates the host-owned outer lifetime.
  Pending IDs resolve once; foreign, blank, zero, missing-for-mutation or expired
  IDs fail before data access.
- Nested success returns ordinary results and never commits. The outer trusted
  operation owns finalization after the Payload operation pipeline completes.
  An adapter commit request cannot settle an independently borrowed operation.
- Any nested operation failure, SQL failure, invalid capability or resource
  violation latches rollback-only, including when framework code catches it.
  The first profile has no savepoint recovery or overlapping child operations.
- Closing requires every child and store operation to have finished. Closure is
  monotonic; escaped work cannot issue receipts, reopen a session or commit.
- Only the fixed deterministic conformance hook may execute inside this first
  profile. General hooks, dynamic access callbacks, file/network work and
  workflow suspension remain rejected at configuration admission.

Reuse the accepted physical-session cancellation, tracked-work drain and
exact-client quarantine mechanisms. Preserve original operation failure and
separate cleanup/settlement evidence even when Payload suppresses its rollback
error. No SQL connection is returned for reuse before confirmed cleanup.

## Read Policy And Pending Documents

For a standalone read with no presented ID, acquire a bounded read-only
Application capability, pin one scope commit sequence and exact CMS binding,
and hold the scope clock for share through the complete read operation. Page
rows and total count use this same snapshot and predicate. The host closes the
capability before returning; it allocates no mutation result, commit or wake.
Presented invalid IDs never select this branch.

Inside a mutation, all reads reuse the owned transaction. The first scalar
profile uses a bounded, transaction-local document working set: one validated
base image and latest pending image per touched Application row, with ordered
attempt records. Point reads consult that set before the pinned base snapshot.
Bounded equality/find/count merge it with base rows before applying the same
predicate, deterministic ordering and pagination. Total count is exact within
the admitted bound; exceeding it is an explicit resource failure, never a
truncated count or partially correct page.

This is a private scalar document representation, not a Dynamic Worker journal,
general SQL interpreter or durable staging store. It does not record arbitrary
callbacks or enable callback replay. Payload validation/hook ordering remains
outside the row capability and follows the pinned pipeline.

Each operation validates the full resulting document, identity, field policy
and uniqueness against the base plus pending view before returning. The scope
write lock excludes competing same-scope writers; native tests must also prove
the applicable schema/build/availability holder orders. Unique checks cannot be
postponed solely to finalization after a hook has observed apparent success.
Indexes and unique keys are ultimately materialized by their existing
Application owners; the adapter does not reproduce their SQL or key encoding.

Repeated updates produce one final revision per row in the outer commit, with
the original base head as `prevCommitSeq` and unchanged creation time. Deleting
an existing row produces the ordinary Application tombstone. Insert followed
by delete has no final row; every attempt still has an authenticated terminal
disposition. Same-value and net-zero commands are not treated as standalone
reads. The first profile uses generated document identity and does not admit
caller-selected ID resurrection.

Proposed ceilings are 64 combined command/store calls, 32 returned rows per
page, 256 examined or retained document identities, 64 KiB per document and
1 MiB total captured input, working-set, result and receipt evidence. Charge
before retention and use stricter existing Application limits where applicable.
The physical profile retains 10 s command, 1 s statement, 500 ms lock and 2 s
cleanup budgets. Bound work before pagination; a small requested page does not
permit an unbounded scan. Larger collection query plans require their own
indexed-query admission and proof.

## Materialization And One Publication

The outer owner closes the working set after all operations finish. It derives
the final distinct row changes from the complete attempt set and invokes an
Application-owned materializer on the same transaction. The materializer reuses
canonical document validation, current-head/revision rules, intrinsic and
developer indexes, unique keys, candidate-schema validation and their invalidation
rules. No new content table or alternate row authority is introduced.

Receipts are issued only after checked materialization, not when Payload returns
an intermediate document. Each records exact transaction, issuer, Application
binding, table/row and materialization identity. The outer collector must account
for each attempted edit as materialized or a verified no-final-row disposition;
an adapter cannot omit an edit by submitting its own final row list. Pure
conservation checks and database failure injection prove this separately from
successful publication. No-op dispositions are internal evidence, not new feed
fact families.

Extract only the publication atoms required by these two real consumers:

1. Application retains its journal/session/lease validation, OCC and retry
   protocol, current lowering and original completion transitions.
2. CMS supplies its independently authenticated materialization, complete
   receipt admission and command-result evidence. It has no fabricated journal,
   lease, Worker grant or Application function session.
3. One private publication owner writes the existing commit header,
   Application-row facts, admitted relation facts when supplied by the existing
   Application path, result evidence, commit wake and scope-clock CAS.
   Preserve Application's observable write/fault ordering, including its own
   session completion between wake creation and clock advancement.
4. A closed set of package-owned participation capabilities authenticates each
   profile's contribution and completion. No adapter registers publishers,
   supplies arbitrary callbacks to publication, chooses commit sequences or
   authors feed/outbox rows.

The first CMS scalar command admits only Application-row facts, with canonical
distinct row ordering and one result/header/wake even if final change count is
zero. It cannot admit CMS tables with relation-bearing definitions, lifecycle sidecars, Medusa
rows/events or the synthetic relational receipt family. Existing Application
relation publication remains supported and must stay byte/ordering compatible.
Any failure through the last publication atom rolls back rows, derived state,
result, header, facts, wake and clock together.

## Retry, Result Identity And Uncertain Settlement

Do not rerun a Payload operation automatically. Capture a stable private
command request key before execution. Use the existing scope-scoped
[idempotency storage](../../../packages/persistence-postgres/src/schema.ts)
for successful result evidence; no second result ledger is proposed.

The CMS operation name occupies the existing nonblank operation-path field as
a registered CMS operation, not an invented published Application function.
Canonical request evidence includes the profile, registered operation, exact
owner/binding identity and canonical arguments. Identity/access-policy evidence
comes from trusted admission. Reserve a domain-separated host-generated request
key and compare the entire stored identity tuple; namespace spelling alone is
not a collision or authorization defense. Preserve all existing Application
keys, encodings, hash comparisons, retention and replay behavior.

Check committed evidence under the scope lock before executing the command.
An exact authorized replay returns retained canonical result bytes without
executing hooks or writing again. Conflicting identity, expired result or
unavailable retained evidence returns a typed refusal. A second concurrent
caller waits within the lock budget or fails; it cannot execute alongside the
first and publish a second result for the same request.

After a lost COMMIT response, quarantine the uncertain connection and use a new
authenticated transaction to resolve the exact outcome. Reuse the existing
[retention-aware outcome validation](../../../packages/persistence-postgres/src/committedPointOutcome.ts):
an authenticated retained outcome and canonical result prove success, with
header correlation where history is retained. A missing header below
`oldestAvailableCommitSeq` is permitted by that existing contract; header
compaction never means non-commit. A missing required retained header remains
corruption, and an expired result remains unavailable without command replay.
Absence of the authoritative outcome proves non-commit only after acquiring
the scope lock beyond the prior transaction's settlement, on the same fenced
target with intact outcome-retention evidence. Until then return decision-uncertain;
never infer rollback from a connection error or a quick unlocked lookup.
Confirmed rollback permits an explicit resubmission of the fixed command, not
an automatic replay of arbitrary framework callbacks. Recovery is authorization
checked and cannot use a stale binding to grant new writes.

## Implementation And Acceptance

Implement this as one private scalar CMS host capability once this contract and
the separate write-policy contract are accepted. Keep internal module boundaries
for admission/lifetime, scalar document policy and working set, Application
materialization, publication and result recovery. Apply installed Effect
contracts at each operation boundary; retain narrow typed failures and exact
causes, with one public-to-adapter error projection. Pure capture and conservation
policies remain independently testable without database startup.

The write-policy prerequisite must authenticate CMS-managed ownership in the
Application publication/binding and reject ordinary Application mutation, direct
adapter, stale owner and forged capability paths. It cannot be an adapter-local
table-name denylist. This proposal does not quietly authorize that owner change
or transfer existing app-writable tables to CMS ownership.

Use one shared scenario definition and fixture per driver for the new host:

- Scalar create/update/delete, repeated same-row edits, exact standalone
  find/count/page snapshot, pending reads, uniqueness and bounded refusal.
- Nested success with one publication; caught nested failure, invalid/pending/
  removed IDs, expired/foreign sessions and active child at closure.
- Positive receipt authentication plus omission/copy/reorder/cross-owner and
  cross-transaction refusal; same-value and net-zero command outcomes.
- Failures after materialization and each publication atom, with no partial
  rows, indexes, unique keys, history, result, facts, wake or clock movement.
- Exact replay, identity collision, concurrent duplicates, lost COMMIT response
  and fresh-connection resolution without duplicate command execution. Include
  valid replay after header compaction, missing required-header corruption and
  expired-result refusal without rerunning the command.
- Ordinary-role PostgreSQL lock barriers through finalization, scope/placement
  isolation, withdrawal/activation/build concurrency, cancellation, cleanup and
  uncertain settlement. PGlite is functional evidence, not native lock proof.

Retain the Application preservation lanes and the synthetic scalar rejection
lanes. Successful CMS publication must not make synthetic relational mutations
committable. No generic publisher registry or parallel Application engine is
needed for this proof.

After the private host, prove the pinned Payload Local API scalar profile with
unchanged result/error assertions and its fixed nested hook. Then admit the
native-relation candidate/rebinding proof, followed by real Medusa Currency.
Shared-core preservation and this proposal alone establish none of those
framework compatibility claims.
