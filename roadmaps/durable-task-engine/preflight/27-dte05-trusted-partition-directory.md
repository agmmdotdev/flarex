# DTE05-P27: Trusted Partition Directory

## Decision

**Outcome: DTE05-C2 complete; admit no scheduler host.** The implementation
moves the existing stable replacement-scope directory mechanics into a
persistence-owned control-plane kernel, preserves the point-mutation directory
contract as a compatibility adapter, and adds one task-specific composition
that converts each inert directory hint into a fresh DTE05-C1 scheduler.

This is not a cross-scope scheduler host. It does not run a scheduler, retain a
queue, persist a checkpoint, install a timer, or bind Queue, cron, alarms, HTTP,
or deployment configuration. DTE05-E remains the first host checkpoint.

## Evidence And Ownership

`fx_control_scope` is the authoritative control-plane directory for shared,
schema-per-scope, and database-per-scope placement. Its unique deployment and
scope identifiers plus current physical locator are already consumed by
`resolveLocatedTrustedScopeAuthorityEffect`.

`pointMutationRedeliveryScopeDiscovery.ts` currently owns two different
responsibilities:

1. generic control-plane mechanics: bounded primary-key scans, one stable
   high-water snapshot, database ordering, continuation validation, driver-row
   capture, replacement-scope filtering, and inert deployment/scope hints; and
2. the point-mutation public names, tagged errors, operation span, package
   subpath, and downstream multi-scope scheduler contract.

Only the first responsibility is shared. DTE05-C2 may extract it behind a
package-internal generic factory whose caller supplies its operation name and
typed error constructors. The point-mutation adapter must preserve its exact
exported types, tags, reasons, causes, SQL builder, page values, freezing,
query order, and tests. Its multi-scope redelivery scheduler is not generalized
or imported by the task system.

## Shared Replacement-Scope Directory Kernel

The package-internal kernel owns:

- a maximum page limit of 100 scanned scope rows;
- `highWaterScopeId` plus `lastScopeId` continuation mechanics;
- a bounded `limit + 1` primary-key scan over `fx_control_scope`;
- stable database-owned text ordering, including legacy spellings;
- decoding the high-water scope, replacement scope, deployment ID, ordinal,
  and continuation-ordering evidence;
- skipping in-range legacy/non-replacement scope spellings without poisoning
  later replacement scopes;
- owned frozen candidates, pages, and continuations; and
- the one narrow Drizzle Promise boundary and detached driver-row snapshot.

It does not own a public package subpath or one universal error union. Each
domain supplies exact constructors for invalid input, corruption, and foreign
SQL failure so the existing point-mutation identities remain unchanged and the
task domain does not publish point-mutation names.

## Task Partition Directory Capability

The private task factory accepts:

- the control-plane metadata database;
- `TrustedScopeAuthorityResolutionPorts` whose target is a
  `LocatedTaskSystemRunAttemptTargetV1`; and
- captured DTE05-C1 partition options.

Its sole `discoverEffect(input)` operation accepts only a bounded page request
and directory continuation. It accepts no deployment, tenant, project,
environment, scope, physical locator, database, or authority record.

For every replacement-scope hint the operation must, sequentially:

1. resolve current located authority from the hint's deployment ID;
2. verify the freshly resolved scope ID still equals the inert directory hint;
3. construct a new DTE05-C1 capability over the freshly selected target; and
4. return only the inert deployment/scope selector plus the standard scheduler.

The output exposes no physical locator, scope clock, authority record, Drizzle
database, pool, or transaction. Directory candidates grant no authority: a
missing, moved, stale, corrupt, or caller-fabricated selector cannot bypass the
fresh resolver and scope-correlation check.

The directory and its returned scheduler instances are lifecycle-free,
operation-local values. Several databases and scopes may coexist, so this
capability remains a plain factory rather than a process-global Context tag.

## Failure Contract

The task directory preserves the shared mechanics behind task-owned errors:

- malformed requests and invalid/inverted continuations are typed input
  failures;
- invalid driver results, metadata, row counts, or ordering are typed stored
  corruption;
- the Drizzle rejection is mapped once to a task-directory SQL failure;
- current placement, provisioning, and scope-clock failures remain the
  existing `TrustedScopeAuthorityError` union;
- directory-hint versus freshly resolved scope mismatch is a distinct
  fail-closed scope-correlation error; and
- invalid C1 scheduler configuration remains
  `InvalidTaskWakeSchedulerConfigurationError`.

No failure is retried here. A future host may retry only admitted transient
failures under its own bounded delivery policy. No directory or authority
failure may be normalized to an empty page.

## Validation Gate

DTE05-C2 requires:

- all existing point-mutation directory and multi-scope scheduler tests to
  remain green without changing their public contract;
- focused PGlite proof that directory discovery, fresh authority resolution,
  C1 construction, and lifecycle settlement use one real end-to-end flow;
- rejection of mismatched, missing, stale, and malformed directory evidence;
- stable continuation proof that scopes above the captured high water are
  deferred until a fresh scan;
- genuine PostgreSQL parity using the same task factory, including scheduler
  reconstruction after directory discovery;
- package typecheck, full durable-task tests, source-map and Trigger-boundary
  checks, workspace typecheck, and both required project reviewers; and
- an exact production-inert package-boundary gate for the new private subpath.

Completion evidence on 2026-08-06 satisfies this gate: the workspace
typechecked; 73 durable-task tests, 11 executor multi-scope scheduler tests, 11
C2 PGlite tests, four genuine-PostgreSQL C2 tests, and the two-test genuine-
PostgreSQL C1 regression passed; and the 65-vector lifecycle, 29-entry
source-map, Trigger, Standard Application, and 57-test script gates passed. The
final reviewer disposition is recorded by the accepting commit.

## Stop Boundary

DTE05-C2 does not authorize:

- executing any returned scheduler;
- a cross-scope loop, queue, retry policy, or fairness policy;
- persisted scheduler checkpoints or continuation storage;
- Queue, cron, alarm, Durable Object, HTTP, Worker, or deployment bindings;
- caller-selected scope or physical placement;
- task-table scans in the control-plane database;
- requested-effect delivery or compute dispatch;
- a migration or new control/task table; or
- production activation.

DTE05-D may add authenticated Queue wake hints. DTE05-E may later add the first
bounded repair host over this directory, but only after its own preflight and
the Roadmap 06 compute-delivery cutline are satisfied.
