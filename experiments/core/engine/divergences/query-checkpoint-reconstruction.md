# Query checkpoint reconstruction

Design status: **Selected for the authorized old-core caller migration**.
Implementation status: **Connected private checkpoint consumer implemented**.
Measurement status: **Unmeasured**.
Owner: [translated Core source retirement](../../../../roadmaps/query-sync-engine/preflight/16-translated-core-source-retirement.md).

## Pinned mechanism and necessary adaptation

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` keeps subscription
processing progress in RAM (`subscription.rs`, `SubscriptionManager.processed_ts`).
Its `write_log.rs` refresh checks a captured log interval and retained edge;
`sync/worker.rs` fences changed identity. A numeric position alone does not
reconstruct a valid subscription or complete retained history.

The existing Flarex private catch-up probe has an actual sync-Durable-Object
reconstruction contract. Preserve that behavior by persisting a small derived
checkpoint in its local SQLite storage. PostgreSQL and the canonical Application
Core remain the only source of committed data and retained-interval evidence.
SQLite neither commits application data nor issues source authority.

## Selected contract

Initialization requires explicit fresh authorization. The adapter captures a
source-bound fixed-target certificate and atomically compares/advances local
progress. It stores source identity with the position, preserves monotonicity
under overlapping replies and reinspects settled state after lost responses.
Limits count real source/state operations rather than subtracting timestamps.
Unknown or malformed existing storage fails closed; no dense baseline fallback
or compatibility migration is needed under the owner's no-retained-data decision.

Same-source sync-object reconstruction can resume only while Core retains the
saved interval. A cold Core may lose that RAM coverage and requires explicit
history reset. Source replacement cannot inherit the old checkpoint. Every
source disclosure still checks current metadata and private authorization;
stored progress supplies no ongoing delivery permission.

## Proof and limits

Use the real Core on PGlite and ordinary-role PostgreSQL for sparse targets,
same-target registration, later data writes, metadata replacement, retention,
cancellation and cold history loss. Use an independent portable synthetic oracle
and actual Workerd SQLite tests for initialization, bounded continuation,
overlap, response loss, corruption, isolation and reconstruction. Migrate the
hosted probe's source and receipt harness with its caller. These witnesses do
not implement query subscriptions, session query sets or browser delivery.
