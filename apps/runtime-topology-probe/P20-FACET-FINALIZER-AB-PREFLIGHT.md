# P20 Facet Finalizer A/B Preflight

Status: complete. The approved boundary was implemented, proved locally, and
measured in the closed P22 production campaign on 2026-07-19.

## Question Under Test

This fourth isolated experiment asks whether the trusted Dynamic Worker Durable
Object facet may own the complete synthetic finalization algorithm instead of
returning a sealed intent for SessionDO to finalize.

The matched paths are:

```text
SessionDO-finalizer control
  gateway -> SessionDO -> trusted snapshot -> attempt facet
          -> facet journal + sealed intent -> SessionDO verification/fence
          -> MockFinish Worker -> SyncDO -> SessionDO response

facet-finalizer candidate
  gateway -> SessionDO -> trusted snapshot -> attempt facet
          -> facet journal + sealed intent -> facet verification/fence
          -> one narrow atomic-finish capability -> MockFinish Worker -> SyncDO
          -> combined committed receipt -> SessionDO response
```

The candidate therefore removes the return-to-SessionDO finalization step. It
does not give user code direct access to the capability. Platform-owned facet
shell code invokes user logic, verifies its result, and alone holds the narrow
finalization port.

## Authority And Trust Boundary

- This probe has no Postgres or Hyperdrive binding and cannot prove a real
  transaction, OCC validation, physical commit, or durable application result.
- In a real Flarex design, trusted facet shell code may run the commit compiler,
  OCC checks, fencing, intent verification, and final commit call. Postgres must
  still atomically persist the attempt/session fence and terminal outcome in the
  same authoritative transaction as application writes.
- The facet receives neither a SyncDO namespace nor a broad executor/session
  binding. Its only finalization authority is one injected `finish` operation.
- User code receives no finalization capability, credential, Worker binding,
  or Postgres handle.
- SessionDO still owns request admission, deterministic identity, snapshot
  acquisition, outer replay/conflict fencing, lifecycle, and cleanup. It does
  not independently call MockFinish for the candidate.
- The candidate facet persists synthetic `running -> finishing -> committed`
  attempt state and the combined response in facet SQLite. That state is probe
  evidence, not authoritative committed application data.
- The returned facet envelope remains strictly decoded and correlated before
  SessionDO accepts it as the response for the admitted attempt.

## Recovery Challenge

Moving logic into the facet does not make JavaScript execution resumable. A
crash after the atomic capability returns but before facet SQLite records
`committed` leaves the facet locally uncertain. The mock probe intentionally
does not pretend to resolve this.

For real Postgres, the atomic transaction must store the terminal outcome under
the attempt fence. A restarted trusted shell resolves uncertainty by looking up
that authoritative outcome; it must not blindly re-run a possibly committed
mutation. SessionDO and delayed cleanup must also refuse to reopen a terminal
or abandoned attempt.

## Challenged Alternatives

Putting the finalization API directly in user code is rejected because it lets
untrusted code bypass result validation, OCC, fencing, and policy. Giving the
facet a broad SessionDO, SyncDO, or database binding is also unnecessary for
this question and would make the capability boundary impossible to interpret.

Keeping every finalization decision in SessionDO is safe but is not required by
Durable Object semantics. The stronger rule is that trusted platform code owns
the algorithm and Postgres owns the authoritative atomic outcome. This
experiment tests the communication and latency consequences of locating that
trusted algorithm in the facet.

## Frozen Production Matrix

- campaign `p20_facet_finalizer_ab_v1`;
- 12 matched pairs with odd pairs control-first and even pairs candidate-first;
  run IDs retain ascending manifest order independently of arm order;
- control `facet_executor_invoke`, candidate `facet_finalizer_invoke`;
- one eligible sample per arm per pair and two excluded warmups per arm in the
  first pair: 28 executions and 24 eligible measurements;
- collector and execution concurrency one, fresh SessionDO and attempt facet,
  stable code, 64 payload bytes, and two logical journal entries;
- exact snapshot, journal, sealed-intent, finish-call, committed-receipt, trace,
  sync-disposition, replay, conflict, and cleanup evidence.

Mechanical success requires zero accepted failures, exactly one candidate
finish-capability call, zero candidate SessionDO finish calls, an exact combined
receipt, and one applied sync wake per unique attempt. Performance promotion
requires at least 10 percent paired internal median improvement and no candidate
internal p95 regression greater than 10 percent. These are descriptive gates
for a small probe, not service objectives.

## Spend And Completion Boundary

The user approved at most USD 0.25 fresh incremental Cloudflare spend for this
P20-P23 extension, within the earlier USD 2 overall probe authorization. Before
deployment, verify the `agmmdotdev` account, paid eligibility, resource absence,
campaign digest, and secret handling. Persist and reread secret-free evidence,
purge application state, delete all temporary scripts and namespaces, and prove
absence.

P21 must finish local validation and both mandatory reviews. P22 may deploy only
the reviewed app-local source and frozen matrix. P23 must apply the thresholds,
record the no-Postgres limitation and recovery cutline, complete teardown, and
commit only `apps/runtime-topology-probe/**`.
