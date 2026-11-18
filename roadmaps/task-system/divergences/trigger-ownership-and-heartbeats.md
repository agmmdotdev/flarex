# Trigger Ownership And Heartbeats

Status: **accepted preservation requirements; runtime mapping pending**.
Source pin and first profile are recorded in [REFERENCES](../REFERENCES.md) and
the [first slice](../slices/01-source-and-installation-contract.md).

Trigger's snapshot heartbeat principally reschedules Redis work and can log a
worker mismatch without rejecting renewal. Flarex retains stronger scope,
binding/principal, ordinary/control mode, live attempt/fence and database-time
lease/duration checks at authoritative writes. A cached row or queued heartbeat
cannot mint execution authority. Recovery obtains fresh authority and settles
uncertain outcomes before another body may execute.

The current [execution subject owner](../../../packages/persistence-postgres/src/tasks/trustedWorkflowExecutionSubject.ts)
reads physical Task run, attempt and binding tables. Migrate that owner to
authenticated logical state; keeping it unchanged or introducing a second
cache/metadata-based issuer would not validate new runs. Adopted engine
signatures/control flow may change to carry only its required capabilities.

Prove stale heartbeat/completion refusal, wrong principal/binding/mode, expired
lease/duration, lost responses and cold charged takeover through both database
lanes. The existing issuer's assertions must execute against new logical runs;
an in-memory fence mock alone is not the claim. Shared lock-graph work follows
the responsible core divergence/ownership gate before runtime edits.
