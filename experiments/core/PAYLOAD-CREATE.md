# Bounded Payload-create prototype

Status: experimental construction slice. No production routing or active Medusa
integration imports this code. The wider design and promotion gates still apply.

## Actual consumer and behavior

The consumer is Payload 3.88.0's real `BasePayload.create` Local API, followed by
its real `findByID`. The collection is the existing performance fixture's
`news-items`: required unique text `headline`, required number `score` with native
default `0`, native timestamps, and the complete returned document. Access,
validation, field processing and hooks execute in Payload; the experiment does
not copy their business algorithm.

The admitted construction profile uses required scalar text/finite number fields
(excluding negative zero, which JSON/JSONB cannot preserve),
at most one unique text field, timestamps, depth zero and trusted configuration
with locally completing callbacks. Callable defaults are preserved. Auth,
versions, upload, localization, relations, optional/array fields, nesting, custom
IDs, general queries, update/delete and arbitrary remote/nonterminating callbacks
are unsupported. This is not a general Payload database adapter. Unsupported
database operations fail and poison an active root. The direct read supports only
the requested identity, with native access and read processing.

The root owns at most 256 inserted rows and 262,144 retained document bytes.
Commands have a database-clock deadline of 30 seconds. Serving PostgreSQL sessions
use 5-second connection/statement timeouts and a 3-second lock timeout. These bound
database work; they do not impose a deadline on arbitrary JavaScript callbacks.

## Replaceable owners

| Source | Implemented responsibility |
| --- | --- |
| [definition.ts](./src/definition.ts) | Framework-neutral immutable scalar metadata, version identity, Effect Schema result decoding and canonical unique keys; pure admission returns Result |
| [payload-definition.ts](./src/payload-definition.ts) | Native configuration admission and translation into those definitions |
| [root.ts](./src/root.ts) | Request-local rows, incremental unique ownership, observations, sticky failure, bounds and one-way freeze; no SQL or native framework import |
| [storage.ts](./src/storage.ts) | Framework-specific Drizzle read/unique/settlement profile |
| [persistence.ts](./src/persistence.ts), [materialization.ts](./src/materialization.ts) | Shared authority, command identity, sessions, deadlines/resolution and atomic row/history/index/event/outcome writes |
| [changes.ts](./src/changes.ts), [callback.ts](./src/callback.ts) | Shared coherent pending state and supervised completing callback lifetime |
| [session.ts](./src/session.ts) | Private PostgreSQL checkout, Drizzle transaction control, failed-BEGIN handling, rollback/drain and release |
| [schema.ts](./src/schema.ts), [drizzle](./drizzle) | Drizzle schema is authoritative; drizzle-kit generates disposable-installation migrations |
| [payload.ts](./src/payload.ts) | Native lifecycle bridge, capability lifetime, interruption/draining and native error projection; no SQL |
| [fixture.ts](./test/fixture.ts), [postgres.ts](./test/postgres.ts) | Explicit disposable installation, restricted role and owned cluster cleanup; not a production installation service |

Composition injects storage into the root/bridge and a physical session into
storage. There is no universal runtime context or engine registry. Application
uses the same lower owners through its separate read/OCC profile; framework
create does not acquire an Application read set or automatic retry. A module
boundary must not add another admission transaction.

The active physical-session owner was inspected: it depends on the current
metadata database and execution diagnostics. This prototype does not import that
graph. Its small private session owner uses Drizzle for all SQL, including
transaction control, on a checked-out pg client. Pinned Drizzle 0.45.2's pool
transaction helper begins before its release guard; the prototype's actual
failed-BEGIN witness protects against that checkout leak. No client or Drizzle
handle reaches Payload callbacks.

## Database layout and authority

One installation has shared logical tables rather than one physical table per
tenant. `documents`, `unique_claims`, `history`, `event_intents` and `commands`
retain current rows, uniqueness, revisions, publication intents and outcomes.
`installation`, `authorities`, `grants`, `definitions` and `clocks` own fresh
enablement, fence, principal membership, selected scalar definition and per-scope
commit order. The shared materializer now supports tombstone revisions and
historical numeric index intervals for the Application slice. The protected
per-scope retention floor refuses stale Application snapshots; there is no GC
service. Framework create/read remains the bounded profile described here.
Event intents are atomic records, not a delivered outbox service.

The serving role is a trusted core login. It has business DML, command/clock
writes and reads, but cannot change protected enablement, fences, membership,
definitions or DDL. PostgreSQL requires UPDATE privilege on a column for row
locking; inert `readLock` columns permit only that privilege on protected rows.
The role is not a sandbox for arbitrary SQL. Callbacks receive no database
capability, and trusted storage is the only serving writer in this slice.

| Writer/read owner | Synchronization |
| --- | --- |
| Open/read/unique observation/settlement | Fresh installation + authority + current-principal grant, holding those rows `FOR SHARE`; selected definition also `FOR SHARE` |
| Disable/revoke/fence writer | Owner UPDATE/DELETE of the same protected rows, conflicting with those share locks |
| Definition replacement | Owner UPDATE of the selected definition, conflicting with its share lock; unrelated definitions do not invalidate a command |
| Settlement | Protected rows, selected definition, command `FOR UPDATE`, then per-scope clock `FOR UPDATE`; database time checked after lock waits |
| Competing create | The same scope-clock order plus the unique-claim primary key; exactly one conflicting claim can commit |
| Abort | Genuine process-issued command/token can mark only its active reservation aborted, including after revocation; it cannot publish data |

This is the first writer set, not a complete installation/placement/retention
protocol. There is no installation replacement, migration/reopen, selected-index
readiness or cross-driver maintenance activation service yet. The deployment has
no live traffic or durable-data migration obligation.

## Actual operation trace

1. Decode bounded input, identify immutable definition and open one durable command
   reservation under fresh protected-row locks.
2. Run native create/access/default/validation processing outside a physical DB
   transaction. At native adapter insertion, observe the required unique keys in
   one short storage visit and add the row to indexed local state.
3. Complete native callbacks, decode the complete result and freeze the root.
4. Settle once under fresh authority/definition locks and scalar scope order.
   Atomically insert documents, unique claims, history, event intents, committed
   result and clock advancement.
5. For the injected post-commit response loss, resolve the durable command under
   fresh authorization. Never repeat the business lifecycle to guess the outcome.
   A committed request replay also reruns current native create access, then
   returns the saved document without rerunning business hooks.

Successful create therefore uses three short storage sessions: command open,
unique observation and settlement. Each still has multiple Drizzle statements,
including fresh gates. This is not a one-query create or a measured optimization.
Native readback is a separate committed read. No physical transaction is held
while callbacks run. Application OCC, cross-framework atomicity and transactional
nesting do not follow from this create-only protocol.

Distinct pending keys use map lookup rather than scanning all retained rows.
The batch witness covers 1/16/64 rows and asserts two ownership lookups per key,
plus the final committed document cardinality. This establishes the exercised
local algorithm only; it does not prove latency, a general indexed query engine
or general framework update/delete/reclaim support. Application separately
exercises replacement, deletion and unique release/reclaim through the same
pending/materialization owners.

Cancellation revokes callback capability use, aborts its signal and drains the
admitted completing callback before resource release. The tests exercise late
adapter refusal, absence of a held PG checkout while a hook waits, and preservation
of interruption together with native failure and cleanup defects. No automatic
retry exists. Aborted/busy request identities are not recycled; expiry cleanup,
retry eligibility and durable recovery across process restart remain later work.

## Running the bounded witnesses

From this folder, install the isolated lock with `pnpm install
--ignore-workspace --frozen-lockfile`. Then run:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm schema:generate
```

The default suite includes database-free contracts, fresh PGlite installations and
a separately owned real PostgreSQL cluster using an ordinary serving role.
PostgreSQL 18 binaries default to `C:/Program Files/PostgreSQL/18/bin` on Windows;
override with `FLAREX_EXPERIMENT_POSTGRES_BIN`. No existing service is reset. The
comparison is opt-in and requires the existing native dependency island under
`work/native-business-baseline/dependencies`.

```powershell
$env:FLAREX_EXPERIMENT_COMPARE = "1"
$env:FLAREX_EXPERIMENT_COMPARE_SMOKE = "1"
pnpm test test/comparison.test.mjs
```

Smoke mode has one pair and is diagnostic only. Without smoke mode the runner
requests five warmups and 30 pairs; its default skip is explicit because this
cross-lane comparison is separate from the bounded behavioral suite. A failed
opt-in comparison remains failing and records its stage/source identity in
`validation/payload-create-failure.json`; it does not fall back to another lane.

Witnesses cover complete native output/default/readback, native validation and
hook rollback, unique conflicts, atomic history/event/outcome agreement, fresh
authority rejection, expiry, current native access on replay, lost-response
resolution, cancellation/draining, sticky root failures and bounded incremental
state. Real PostgreSQL additionally checks protected-role denial, a grant deletion
blocked behind accepting work, and pool recovery after a terminated BEGIN backend.
The lost-response test injects failure after a known commit; it is not a real
network partition or an exhaustive uncertain-COMMIT test.

## Comparison blocker and next gates

The [comparison runner](./test/comparison.test.mjs) invokes actual native Payload,
existing `preparePayloadFlows` and the experimental host with complete result and
readback assertions. It fingerprints executing experiment, active and installed
native sources. It does not replace active behavior with a SQL surrogate.

The current active lane fails before `payload-create`, during
`createProtectedPayloadLatencyResource` / `cmsHostFixture` setup. Expected: prepare
an admitted scalar collection and run the existing create sample. Actual:
`FrameworkMigrationRepositoryError: Stored framework migration metadata is
corrupt`, in `migrationPlanRepository`'s stored-plan verification. Its owner is
the active framework migration/canonical verification path; the underlying cause
is not established. No active source was patched, no check was bypassed, and
no successful three-lane cohort exists. Keep this witness and correct its real
owner in separately authorized integration scope before using that baseline.

The isolated test host resolves a single Effect instance across experiment and
workspace imports; cross-install Schema identity differences must not become
false validation failures. The migration refusal still reproduces with that
configuration. This does not establish its underlying cause. The initial report
is retained in `validation/payload-create-failure-initial.json` and the latest
diagnostic in `validation/payload-create-failure.json`.

No performance gate has passed. Full paired timings, thread/server CPU, SQL and
packet/byte attribution, scalar-lock occupancy, scaling/concurrency and hosted
Worker/Hyperdrive proof remain required. Native Payload also has fewer durable
history/outcome obligations, so raw query counts alone cannot establish parity.
The initial failure report has differing before/after source hashes during shared
checkout development; the latest reproduction has matching hashes. Both are
diagnostic failure witnesses, not performance baseline cohorts or proof of the
underlying defect's cause.

The [standalone Application construction slice](./APPLICATION.md) now exercises
point/missing/range dependencies, pending edits, actual conflicts and outer retry
through the shared foundation. General queries, connected reactivity, Medusa
Product and mixed execution remain separate gates. Do not infer those contracts
from Payload unique-create tests; active Medusa remains on its existing core.
