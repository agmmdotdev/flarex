# P16 Facet-Resident Executor A/B Preflight

Status: approved on 2026-07-19; implementation in progress.

## Decision Boundary

This is a third isolated runtime-topology experiment. It does not activate the
conditional FlarexDB `C07A` journal move and does not change an active Flarex
roadmap. It tests whether a Dynamic Worker Durable Object facet can complete a
bounded synthetic execution from a trusted snapshot without calling back out
during the handler.

The matched paths are:

```text
bound-read control
  gateway -> SessionDO -> attempt facet -> private MockRead Worker
          -> facet read set + SQLite journal/result
          -> SessionDO -> private MockFinish Worker -> SyncDO

snapshot-seeded facet candidate
  gateway -> SessionDO -> private MockRead Worker
          -> attempt facet receives the exact snapshot
          -> facet-local read set + SQLite journal/result
          -> one sealed FacetCommitIntentV1 returned to SessionDO
          -> private MockFinish Worker -> SyncDO
```

Both arms perform the same trusted synthetic read and finish. The candidate
changes only whether the read capability is called while the facet handler is
running. A locally fabricated snapshot is forbidden because it would remove a
real communication boundary instead of moving it.

## Authority And Trust Invariants

- Postgres remains the only possible authoritative committed-data store. This
  no-Postgres probe never reports a real application commit.
- The private MockRead Worker selects the synthetic snapshot in both arms.
- The candidate facet receives no read capability, SessionDO capability,
  SyncDO namespace, supervisor SQLite access, network access, credential, or
  committed-data binding.
- The facet owns only sandbox execution, a logical read set, temporary journal
  rows, separate result evidence, and a bounded sealed intent.
- SessionDO treats the facet envelope as untrusted. It recomputes intrinsic
  relationships and accepts only the exact current session, attempt fence,
  snapshot, journal sequence, result, and digest.
- The same private MockFinish Worker and SyncDO path run after both facets so
  finalization is not a candidate-only latency advantage.
- The supervisor cannot query facet SQLite. Normal completion returns the
  sealed intent in the facet response; recovery may query only the exact facet
  API.
- Every sample uses a fresh SessionDO and an attempt-scoped facet/Worker Loader
  identity. Cleanup deletes the facet after terminal handling, and delayed
  cleanup cannot reopen an attempt.
- Facet persistence does not resume JavaScript. A mid-handler failure remains
  an abandoned synthetic attempt; the real runtime would require a new fence,
  snapshot, and deterministic rerun.

## Challenged Alternatives

Moving OCC, physical commit compilation, Postgres credentials, or final outcome
authority into dynamically loaded code is rejected. The facet is an isolated
execution owner, not a transaction authority.

Treating the existing external-Worker control as if all execution lived in the
Worker is also inaccurate. Its function wrapper and journal already run in the
facet; the external Worker supplies the trusted read and finish capabilities.
This gate therefore measures removal of the in-handler read callback and adds
an explicit sealed commit-intent contract instead of renaming the old path.

The snapshot-seeded candidate does not solve arbitrary functions that discover
unbounded reads dynamically. It proves only the bounded supplied-snapshot
shape. A later real executor must separately choose restricted syscalls,
batching, or proven cache/snapshot inputs for dynamic reads.

## Frozen Production Matrix

- campaign ID `p16_facet_executor_ab_v1`;
- 12 alternating replicate-matched pairs;
- control `executor_worker_invoke` and candidate `facet_executor_invoke`;
- one eligible sample per arm per pair plus two excluded warmups per arm in the
  first pair: 28 total executions and 24 eligible measurements;
- collector concurrency one, execution concurrency one, new SessionDO and
  attempt facet per sample;
- stable code, 64 payload bytes, two logical journal entries, one trusted
  snapshot, and one final sync wake per sample;
- exact trace trees, startup observations, snapshot/capability-call counts,
  sealed-intent correlation, sync disposition, and external caller duration;
- zero accepted failures, missing durations, abandoned claims, duplicate wakes,
  or cleanup exclusions.

Mechanical success requires zero failures, an exact sealed intent, and zero
candidate in-handler read-capability calls. The locality threshold requires the
candidate whole-facet paired median to improve by at least 20 percent. The
end-to-end performance threshold requires at least 10 percent paired internal
median improvement and no candidate internal p95 regression greater than 10
percent. These small-sample values are descriptive experiment gates, not a
service-level objective.

## Spend And External-State Boundary

The user approved a fresh maximum of USD 0.25 incremental Cloudflare spend for
P16-P19. The expected Dynamic Worker charge is near the prior USD 0.06 run, but
the live campaign must stop before the hard cap if usage evidence differs.

Before deployment, reverify the authenticated account, paid eligibility,
existing-resource absence, exact script names, campaign digest, request and
identity budgets, secret handling, and ordered teardown. Deploy sync, mock, and
gateway in dependency order. Persist and reread secret-free raw and summary
evidence before application purge. Then remove the gateway secret, apply
deleted-class teardown migrations, delete all three scripts, and prove script
and Durable Object namespace absence.

## Completion Proof

P17 must prove locally the strict snapshot/intent schemas, exact request and
receipt correlation, no candidate read binding, forged-envelope rejection,
attempt replay/conflict/busy behavior, completed and unstarted cleanup, full
test suite, typecheck, all Wrangler dry-runs, and both mandatory project
reviews.

P18 may run only that reviewed source and frozen campaign. P19 must record the
matched correctness and latency result, Dynamic Worker usage and bounded cost,
the no-Postgres/dynamic-read limitations, application purge, external absence
proof, and an app-only commit.
