# P19 Conclusions And Teardown

Status: complete on 2026-07-19. The isolated facet-resident executor A/B is
closed, application state is purged, all probe Workers and Durable Object
namespaces are absent, and no active Flarex architecture roadmap changed.

## Decision

Do not promote the tested facet-resident topology as the executor placement on
this mock latency result alone.

Moving the logical read, persisted temporary journal, result, and sealed
commit-intent construction into the facet clearly improved the local facet
boundary. The paired whole-facet median was 83.95% faster and passed the
predeclared locality threshold. But the paired complete internal path improved
only 2.39%, below the required 10%, while candidate p95 regressed 8.68%.

The experiment therefore answers the earlier question precisely: the reverse
facet-to-SessionDO callback was a real and removable cost, but it was not the
dominant cost of the complete mocked request after placement changed. Trusted
finish/Sync and other SessionDO work remained much larger.

## Architecture Meaning

The probe supports these narrow conclusions:

1. SessionDO can obtain one exact trusted snapshot and seed a Dynamic Worker
   facet that has no read binding or supervisor capability.
2. The facet can own and read back temporary read-set, journal, result, and
   sealed-intent state while SessionDO remains the untrusted-envelope verifier.
3. Control and candidate can share exact durable attempt fencing, replay,
   conflict, busy, finalization, and cleanup semantics.
4. Eliminating the in-handler read materially shrinks facet residency, but did
   not materially shrink the complete mock path under the frozen rule.

This does **not** show that a facet-resident executor is a bad architecture.
The real decision still depends on the Postgres-backed point executor, actual
snapshot transport, journal/commit-intent size, commit compiler, OCC,
known-settled retry, authoritative outcome recovery, and subscription wake
semantics. The result is evidence for optimizing the placement after that path
exists, not evidence for moving Postgres authority into a facet.

## Recovery Cutline

Facet persistence does not resume JavaScript. A termination in `running` or
`finishing` remains fenced in this probe; the bounded campaign must reconcile
and purge. A production executor still requires a fresh attempt fence,
deterministic rerun at a known snapshot, and authoritative outcome lookup.

## Ordered Teardown Receipt

The runner persisted and reread secret-free raw/summary artifacts, then
returned campaign `purgeState: "purged"`. External teardown then ran in order:

1. Gateway deleted-class migration removed bindings and public route.
2. The gateway bearer secret was explicitly deleted.
3. Gateway Worker was deleted.
4. Private mock Worker was deleted.
5. Sync deleted-class migration removed `ProbeSyncDO` data.
6. Sync Worker was deleted.

Final authenticated proof:

| Boundary | Result |
| --- | ---: |
| Exact probe scripts present | 0 of 3 |
| Deployment reads | 3 of 3 returned Cloudflare `10007` |
| Maximum-page namespace inventory | 0 rows, total 0 |
| Independent default-page namespace inventory | 0 rows, total 0 |
| Matching probe namespaces | 0 |
| Local probe token/origin environment variables | 0 |

Historical analytics and ignored local evidence are not live resources and
remain unstaged.

## Final Validation

- package typecheck/build passed;
- all 27 test files and 238 tests passed on the final runtime code;
- creation and deleted-class teardown Wrangler dry-runs passed;
- focused runner validation passed after adding redacted failure-cause output;
- both mandatory TypeScript/Effect and systems-quality reviews were clean on
  the final significant behavior diff; and
- production evidence was publishable and application-purged before external
  resource deletion.

Wrangler 4.100.0 `delete --dry-run` remained open for already-absent scripts;
the non-mutating process was terminated and not counted as a pass. Actual
ordered deletions and independent `10007`/namespace absence checks succeeded.

## Closed Goal

The app delivered the approved facet-versus-bound-read communication probe,
measured it within the spend ceiling, accepted the strong locality result,
rejected promotion on the end-to-end threshold, preserved authority and
recovery limits, and removed every temporary Cloudflare resource. It remains
an app-local future experiment rather than a current Flarex roadmap.
