# Framework Conformance And Activation

## Status And Scope

Status: accepted evidence and activation contract; all framework activation
gates pending

This plan owns the evidence required to move a framework integration from a
private adapter proof to hosted and production use. It does not itself activate
Payload, Medusa, public APIs, routes, or deployment bindings.

## Evidence Lanes

### Pure contract evidence

- canonical schema encoding and digest determinism;
- structural and semantic plan determinism;
- compatibility and unsupported-capability classification;
- relation/link cardinality and delete-policy planning;
- typed error mapping; and
- binding and readiness policy.

### PGlite fast lane

- repository and adapter behavior;
- migration happy paths and deterministic replay;
- row/link/projection mutation behavior;
- rollback and commit-fact composition where PGlite is representative; and
- broad upstream conformance matrices.

PGlite cannot prove PostgreSQL lock, isolation, DDL, driver, or high-contention
claims.

### Genuine PostgreSQL lane

- transaction isolation, nested reuse, any admitted savepoint behavior, and
  rollback;
- lock order and deadlock behavior;
- migration claim fencing, lease loss, takeover, and uncertain settlement;
- unique, foreign-key, check, and link-cardinality constraints;
- concurrent write conflicts and replay only where the owning framework
  contract declares idempotent behavior;
- atomic row/link/fact/outbox publication;
- physical installation and activation races; and
- realistic query plans and index behavior.

### Framework conformance lane

- unchanged relevant Medusa module/service/repository/Link/Query tests for each
  claimed commerce feature;
- unchanged relevant Payload adapter/API/request/lifecycle tests for each
  claimed CMS feature;
- exact compatibility bindings to pinned framework revisions; and
- explicit inventories of skipped, unsupported, or intentionally divergent
  behavior.

### Application regression lane

- current application schema, OCC, commit, relation, readiness, and activation
  tests remain green;
- no application caller routes through framework code accidentally;
- no fallback, dual read, dual write, or comparison authority appears; and
- public and production behavior does not change during private adapter work.

### Recovery and operator lane

- process crash and cold replay;
- migration interruption and resumption;
- lost response and duplicate request;
- backup/restore with artifact and binding reconciliation;
- corrupted artifact, receipt, or stored-row rejection;
- deployment rollback by switching bindings to a retained compatible
  installation, plus forward repair;
- observability, bounded diagnostics, and redaction; and
- repair/import authority that preserves core invariants.

### Hosted and scale lane

- real Hyperdrive/Worker lifecycle where the deployment owner requires it;
- connection, statement, memory, CPU, and duration ceilings;
- representative pricing, inventory, cart, product, CMS population, and
  relation/link fanout;
- scope isolation and noisy-neighbor behavior;
- scope-clock contention and commit throughput;
- migration/backfill load and foreground traffic interference; and
- feed, outbox, query-sync, and reconnect lag.

## Activation Stages

### Private contract

Value models, planners, adapters, and focused tests exist behind private package
boundaries. No route or deployment binding uses them.

### Private integrated vertical

One exact framework operation reaches authoritative Postgres storage through
the intended host, commits once, and returns framework-compatible behavior.
It remains explicitly selected in tests or development tooling.

### Hosted inert proof

The exact bundle and runtime operate in the target host with real secrets,
placement, database connectivity, limits, and cleanup evidence. Normal product
traffic still cannot select it.

### Production-capable binding

The framework artifact, installation, readiness, and binding contracts have
passed conformance, recovery, scale, and operator gates. Production selection
still requires an explicit owner-approved activation decision.

### Public API activation

Generated `ctx.cms`, `ctx.commerce`, SDK, dashboard, HTTP, or GraphQL surfaces
are separately owned product contracts. Internal adapter readiness does not
stabilize or expose them automatically.

## Required Failure Proofs

At minimum, each integrated lane proves the failures applicable to its enabled
capability profile:

- stale scope generation;
- wrong semantic owner;
- wrong or withdrawn schema binding;
- unsupported artifact capability;
- migration lease loss and duplicate migration execution once that lane admits
  a lifecycle or data-migration plan;
- failed constraint or validation;
- transaction rollback;
- database timeout or connection loss;
- uncertain settlement and authoritative lookup;
- duplicate-command behavior and idempotency replay only for an API whose
  owning framework contract admits an idempotency key; otherwise fail-closed
  uncertain-settlement lookup and no automatic replay;
- post-commit event delivery failure once that lane admits event intents;
- restart before and after commit; and
- cross-scope and cross-transaction capability misuse.

## Compatibility Claims

Compatibility is feature-specific and pinned to exact source evidence. Passing
one scalar CRUD or Currency vertical does not imply Payload or Medusa parity.

Every claim records:

- exact framework revision and package set;
- enabled modules/features;
- test suites and skipped cases;
- database and runtime lane;
- known divergences;
- migration starting state; and
- operational limits.

## Production Stop Boundaries

Do not activate production when any of these remain unresolved:

- a second write, commit, feed, or outbox authority;
- application or framework writes that can bypass their semantic owner;
- partially active module or link schemas;
- runtime DDL application;
- raw database capability exposure;
- unbounded query, relation, migration, or diagnostic behavior;
- unproven PostgreSQL concurrency or recovery claims;
- missing framework-version provenance; or
- an implicit public API or routing change.

## Exit Criteria

The framework-integration domain becomes production-capable only when every
enabled lane has:

- the exact ready artifacts/installations it owns or references;
- an atomic framework overlay binding conditioned on the exact current
  Application head;
- for Payload content, a configuration/provenance overlay referencing the exact
  canonical Application artifact, installation, table identities, and
  write-policy evidence without an independent content installation;
- one semantic write owner;
- complete transaction and commit participation;
- framework conformance for claimed behavior;
- genuine-PostgreSQL concurrency and recovery evidence;
- hosted runtime and operator evidence;
- measured scale ceilings and alerts; and
- a separate explicit production activation decision.
