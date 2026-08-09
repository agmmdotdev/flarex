# Preflight 31: DTE05 Connected Repair Runner

## Status

**Decision:** Admit DTE05-E2C1 only. This checkpoint connects the E1 Task
repair sweep and E2A continuation codec to the E2B fenced checkpoint protocol.
Static reconstruction is proved in PGlite; duplicate-host exclusion and expiry
takeover are proved in PGlite and genuine PostgreSQL. The corrected E1
continuation now also proves exact high-water restart. The slice remains
production-inert.

DTE05-E2C2 is admitted separately by
[`32-dte05-postgres-deadline-policy.md`](./32-dte05-postgres-deadline-policy.md):
database-owned statement, lock, and transaction limits on a dedicated Task
repair pool plus deliberately stalled-transaction proof. That checkpoint is
complete as of 2026-08-10. DTE05-E3 retains the
scheduled Worker host, Wrangler Cron Trigger, deployment, and activation.

## Why E2C Is Split

The connected runner owns orchestration and durable progress. It does not own
the PostgreSQL connection's ability to abort, quarantine, or replace a driver
operation that never settles. An Effect timeout cannot safely manufacture a
known transaction outcome while a database command remains in flight.

E2C1 therefore proves the complete ordinary settlement path and crash/restart
window without claiming a hard wall-time bound. E2C2 now configures and proves
database/connection-owned deadlines at the located transaction owner; a
scheduled host still requires E3's separate admission.

## Admitted E2C1 Contract

The private connected runner:

1. acquires the singleton Task repair claim through the E2B port;
2. decodes only the canonical E2A continuation evidence;
3. runs exactly one bounded E1 repair cycle from that continuation;
4. encodes and checkpoints the returned continuation, including explicit
   `null` exhaustion, before release; and
5. releases only while the last settled scheduler observation still proves
   ownership.

The runner retries exactly one direct-class confirmed rollback when its
remaining claim/run reserve admits the identical operation. It never retries
an uncertain decision. A failure before checkpoint may release the still-known
claim; once checkpoint settlement begins, uncertainty or interruption leaves
recovery to expiry and durable takeover rather than guessing the outcome.

The E1 sweep remains the sole owner of directory traversal, fresh scope
resolution, per-partition scheduler calls, count accounting, typed-failure
isolation, and high-water continuation semantics. The connected runner does
not reproduce those algorithms or interpret a continuation as authority.

## E2C1 Proof Gate

E2C1 must prove:

- persisted canonical continuation is decoded, passed to E1, re-encoded,
  checkpointed, and recovered after repository/process reconstruction;
- duplicate genuine-Postgres runners serialize to one acquired claim and one
  busy observation;
- a stopped host after repair work but before checkpoint leaves the old durable
  continuation and recovers only after database-authoritative expiry/takeover;
- repeated bounded runs advance the exact E1 directory/partition high-water
  instead of restarting at the first scope;
- point-mutation scheduler behavior remains unchanged after extracting shared
  checkpoint-run cleanup/retry mechanics;
- PGlite and genuine PostgreSQL agree on ordinary connected outcomes; and
- no application, Worker entrypoint, scheduled handler, binding, or deployment
  imports the new private runner.

## Admitted E2C2 Timeout Gate

E2C2 is owned by the connected PostgreSQL transaction/connection layer and its
exact implementation and proof contract is recorded in Preflight 32. The
database settings must exist from connection startup, remain confined to a
dedicated Task repair pool, and preserve the existing located transaction
owner's settlement and quarantine behavior. The gate is complete on
PostgreSQL 18.3.

## Resolved E1 Continuation Defect

E2C1 restart analysis exposed a defect in the existing E1 continuation owner.
When a partition scheduler returns an inner due cursor, `TaskRepairSweepV1`
stores that cursor beside the directory state that existed *before* the current
directory page. For the first directory item that state is `unstarted`; it does
not retain the captured directory high-water mark.

Reproduction:

1. discover scope B as the first item and return an inner Task due cursor;
2. persist the resulting sweep continuation;
3. insert a new scope A that sorts before B;
4. reconstruct the runner and resume the persisted continuation;
5. directory discovery starts a new snapshot at A, candidate correlation fails,
   and the current E1 policy silently starts A instead of resuming B.

Expected behavior is exact resume of B under the original directory high-water
snapshot. The approved E1-local correction now records the directory position
after B beside B's active partition state, as either a correlated continuing
cursor or an exact exhausted high-water marker. Resume does not restart
discovery:
it freshly resolves B's exact deployment/scope identity through the
repair-directory owner, rejects a mismatched result, resumes B's inner due
cursor, and advances to the recorded post-B directory position only after B is
finished or isolated as failed.

This keeps the shared replacement-scope directory cursor unchanged, preserves
fresh trusted-authority resolution, and prevents both cursor abandonment and
post-snapshot admission. Private pre-correction continuation evidence remains
decodable when the new field is absent; after that expected partition settles,
the old cycle closes and a later run starts a fresh snapshot. Focused tests
prove that an inserted earlier scope is deferred while a later scope from the
original snapshot still runs. The E2C1 high-water restart gate is therefore
complete; database-owned hard timeout proof is completed separately by E2C2.

Completion evidence on 2026-08-09:

- the 20-test E1 sweep lane proves exact original-snapshot advancement,
  repair-directory and scheduler receiver preservation, mismatched-resolution
  rejection, filtered pages, bounded accounting, and timeout classification;
- all six canonical continuation-codec tests and all 34 connected-runner/core
  tests pass, including pre-correction evidence compatibility and reconstructed
  inner-cursor resume through fresh exact candidate resolution;
- the 11-test PGlite repair-directory/checkpoint regression lane passes; and
- a disposable genuine-PostgreSQL 18 cluster passes all three E2C1 connected
  claim, duplicate-host, crash, expiry, and takeover tests, then is stopped and
  moved to the Recycle Bin.

## Stop Boundary

E2C1 does not authorize:

- treating checkpoint bytes, directory spellings, or scheduler handles as
  tenant, scope, lifecycle, locator, or execution authority;
- changing Task lifecycle, Queue, requested-effect, OCC, commit, or outbox
  owners;
- claiming a hard operation or wall-time bound;
- adding a runtime bridge, scheduled Worker handler, Wrangler configuration,
  Cloudflare binding, deployment, or production activation; or
- marking DTE05-E2, DTE05-E, or Roadmap 05 complete.
