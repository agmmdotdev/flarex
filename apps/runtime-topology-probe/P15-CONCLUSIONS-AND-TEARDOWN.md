# P15 Conclusions And Teardown

Status: complete on 2026-07-18. The isolated SessionDO executor A/B is closed,
application state is purged, all probe Workers and Durable Object namespaces
are absent, and no active Flarex architecture roadmap was changed.

## Decision

Do not promote the tested reverse-callback topology as the executor placement
on latency grounds.

The SessionDO candidate was correct in this bounded synthetic run, but it was
slower than the external trusted Worker control. Its paired internal median was
612 ms slower, its aggregate internal p95 regressed by 1,057 ms, and it failed
the predeclared 20% improvement threshold. The dominant difference was the
facet's token-gated service-binding round trip back into its owning SessionDO:
544 ms median versus 56 ms for the control's mock-read Worker call.

This does not show that Durable Object serialization is the problem. The
matrix intentionally used one query or mutation per fresh session with
concurrency one. The measured penalty came from the added reverse communication
shape, not from several independent invocations contending on one SessionDO.

## Architecture Meaning

The probe supports these narrow conclusions:

1. A normal Worker can host a SessionDO that loads an attempt-scoped Dynamic
   Worker facet, exposes one token-gated read through a self-bound entrypoint,
   receives a sealed temporary journal, performs a trusted synthetic finish,
   and wakes a separate sync Durable Object.
2. Attempt fencing, exact replay, busy/conflict behavior, same-ID WorkerCode,
   completed and unstarted cleanup, application purge, and deployment teardown
   can be made explicit and testable.
3. In this run, moving the synthetic executor adapter into SessionDO while the
   facet called back into that same SessionDO made the timed path worse.

The result does **not** prove that the real executor must remain a separate
Worker. A later design could avoid the reverse callback by giving the facet a
fully bounded snapshot capability or by hosting more trusted work directly in
the SessionDO. That decision must wait for the Postgres-backed executor proof
and compare the same real artifact, journal/commit intent, OCC, known-settled
retry, and outcome-recovery semantics.

Postgres remains the only authoritative committed app-data store. SessionDO
and facet SQLite remain non-authoritative coordination and temporary journal
state. This mock result does not move final commit, OCC, or commit compilation
into a Durable Object.

## Recovery Cutline

Facet persistence still does not resume a lost JavaScript stack. A SessionDO
that terminates in `running` or `finishing` remains fenced in this probe. The
bounded experiment must stop, reconcile its outer claim, and purge. A real
executor needs the accepted known-settled retry and uncertain-outcome recovery
design before this pattern can host production work.

## Ordered Teardown Receipt

The production runner first persisted and reread the secret-free raw and
summary artifacts, then returned campaign `purgeState: "purged"`. External
teardown followed in dependency order:

1. The gateway teardown Worker applied the deleted-class migration, removed
   all service, Worker Loader, and Durable Object bindings, and disabled the
   public route.
2. The bearer secret was explicitly deleted.
3. The gateway Worker was deleted.
4. The private mock Worker was deleted.
5. The sync teardown Worker applied its deleted-class migration.
6. The sync Worker was deleted.

Final authenticated proof:

| Boundary | Result |
| --- | ---: |
| Exact probe scripts present | 0 of 3 |
| Deployment reads | 3 of 3 returned Cloudflare `10007` |
| Maximum-page namespace inventory | 0 rows, total 0 |
| Independent default-page namespace inventory | 0 rows, total 0 |
| Matching probe namespaces | 0 |
| Local probe token/origin environment variables | 0 |

Historical analytics and ignored local evidence remain; neither is a live
Cloudflare resource. The local artifacts contain only synthetic, secret-free
evidence and are not staged or committed.

## Final Validation

- package typecheck passed;
- all 27 test files and 230 tests passed;
- sync, mock, gateway, gateway teardown, sync teardown, and all delete paths
  passed fresh Wrangler dry-runs;
- both mandatory TypeScript/Effect and systems-quality reviews were clean on
  the final behavior diff; and
- production evidence was complete, publishable, and application-purged before
  external resource deletion.

## Closed Goal

The app delivered the approved SessionDO-versus-external executor communication
probe, measured it in production within the spend ceiling, rejected the
candidate on its predeclared latency criterion, preserved the correctness and
recovery limits, and removed every temporary Cloudflare resource. The result
remains an app-local future experiment rather than a current Flarex roadmap.
