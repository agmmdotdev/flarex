# P17 Local Facet-Resident Executor Proof

Status: implementation, local proof, and mandatory review complete on
2026-07-19. This remains an isolated future experiment and does not activate a
Flarex runtime roadmap.

## Proven Matched Paths

```text
bound-read control
  gateway -> SessionDO durable attempt fence -> attempt facet
          -> bound MockRead Worker -> facet-local execution state
          -> SessionDO -> MockFinish Worker -> SyncDO

snapshot-seeded candidate
  gateway -> SessionDO durable attempt fence -> MockRead Worker
          -> attempt facet -> facet-local execution state
          -> SessionDO -> MockFinish Worker -> SyncDO
```

Both arms use the same SessionDO `running -> finishing -> completed` attempt
state, storage synchronization points, terminal response replay, conflict and
busy rejection, attempt-scoped loader/facet identity, MockFinish Worker, and
SyncDO wake. The only intended communication difference is whether the trusted
snapshot is obtained while the facet handler is running or immediately before
the handler receives its strict request.

## Facet Execution State

Both facets persist, synchronize, and read back these synthetic records before
returning:

- the exact logical read-set digest and synthetic snapshot revision;
- the ordered temporary journal rows and journal seal;
- separate result evidence; and
- a bounded sealed commit-intent envelope binding the snapshot, journal seal,
  result digest, attempt, code, scope, and synthetic commit sequence.

SessionDO does not trust the returned envelope. It independently reconstructs
the expected snapshot relationship, journal seal, result digest, and intent
digest. Forged or mismatched evidence fails closed. The candidate WorkerCode
has no read binding or executor capability, and the three valid WorkerCode
constructors statically separate bound-read, SessionDO-capability, and
snapshot-seeded modes.

This is still mock execution. The sealed intent is not a Postgres commit, OCC
result, authoritative outcome, or subscription event.

## Attempt And Cleanup Proof

For both production arms, local tests prove:

```text
new exact attempt -> running -> finishing -> completed
same completed request -> byte-identical stored response
same in-progress request -> 409 busy
changed request under same attempt -> 409 conflict
```

A paired partial campaign executes one control and one candidate, reconciles
their second planned samples as unstarted, seals evidence, and purges. Purge
reconstructs and deletes exactly one completed facet in each arm and reports
zero physical facet deletions for each unstarted attempt. A tracked facet
without its required attempt evidence still fails closed.

The recovery cutline is unchanged: JavaScript stacks are not resumable. A
termination in `running` or `finishing` remains fenced, and this bounded probe
must reconcile and purge it. A real executor still needs the accepted
known-settled retry and uncertain-outcome recovery design.

## Frozen Production Matrix

The complete manifest is pinned field-for-field in tests:

- campaign `p16_facet_executor_ab_v1`;
- 12 alternating matched pairs, control before candidate;
- 24 eligible measurements plus four excluded warmups in the first pair;
- 28 total executions, concurrency one;
- fresh SessionDO, attempt facet, and attempt-scoped loader identity per sample;
- stable source, 64 payload bytes, two journal rows, and new-session mode; and
- 28 bounded loader identities, 1,792 payload bytes, and 56 journal entries.

## Local Receipt

The final checkpoint passed:

- package typecheck and build;
- all 27 Vitest files and 238 tests;
- focused protocol, gateway, replay/concurrency, campaign, run, and purge
  validation after the final behavior fixes;
- sync, mock, gateway, gateway-teardown, and sync-teardown Wrangler dry-runs;
- authenticated Cloudflare absence for the prior gateway script (`10007`); and
- fresh mandatory TypeScript/Effect and systems-quality reviews with no
  findings on the final app-only diff.

Wrangler 4.100.0's `delete --dry-run` remained open without output for an
already-absent script, including in CI/force mode. The command was terminated
without mutation. Creation and deleted-class migration dry-runs are green;
actual deletion and authenticated absence proof remain mandatory in P19.
