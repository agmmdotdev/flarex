# P23 Conclusions And Teardown

Status: complete on 2026-07-19. The isolated facet-finalizer A/B is closed,
application state is purged, all probe Workers and Durable Object namespaces
are absent, and no active Flarex architecture roadmap changed.

## Decision

Do not promote facet-owned finalization for a latency reason on this mock
result.

The experiment does show that trusted platform code inside a Dynamic Worker
facet can verify a synthetic commit intent, enforce its attempt fence, invoke a
narrow finalization capability, and return an exact committed receipt without
giving user code that authority. All mechanical checks passed.

It did not make the complete request materially faster. Paired internal
improvement was -1.07% against the required positive 10%, and aggregate
internal p95 regressed 50.02% against the allowed 10%. Moving the call changed
where the finalization wait was nested; it did not eliminate the synchronous
finish and SyncDO work.

## Architecture Meaning

The placement rule is simpler than “final commit must run in SessionDO”:

1. Trusted facet shell code may host commit compilation, OCC validation,
   attempt/session-fence checks, intent verification, and the final database
   call if its database capability is narrow and user code cannot reach it.
2. Postgres must atomically store the application writes, accepted fence, and
   terminal outcome. Logic placement does not transfer authority to facet
   SQLite.
3. SessionDO can remain the admission, request identity, outer replay/conflict,
   lifecycle, response-correlation, and cleanup coordinator. It need not
   duplicate the facet's trusted finalization algorithm.
4. A real implementation still has to prove the Postgres transaction and
   uncertainty protocol. This no-Postgres mock cannot justify moving the
   current executor or OCC implementation.

The result therefore supports the user's feasibility point: even the final
commit algorithm can run in a trusted facet runtime. It rejects only the
stronger claim that relocating it is already a demonstrated latency win.
Revisit placement after a narrow Postgres point executor exists, because only
that experiment can test real transaction cost, Hyperdrive behavior, OCC,
outcome lookup, and subscription wake semantics.

## Recovery Cutline

Facet SQLite persistence does not resume a lost JavaScript stack. The local
apply-then-throw proof deliberately leaves facet and outer state `finishing`
and reports non-retryable `outcome_uncertain`; it neither replays success nor
blindly executes finalization again. Known-settled `gap` and `stale` outcomes
remain exact replayable 409 responses rather than uncertainty.

For production, the Postgres finalization transaction must record the terminal
outcome under the same accepted attempt/session fence as the application
writes. A restarted trusted facet resolves a lost response by reading that
authoritative outcome. If no terminal outcome exists, recovery uses a fresh
attempt fence and a deterministic rerun at a known snapshot. Delayed cleanup
must never reopen an abandoned or terminal attempt.

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
- all 27 Vitest files and 247 tests passed on the final runtime code;
- sync, mock, gateway, gateway teardown, and sync teardown Wrangler dry-runs
  passed;
- both mandatory TypeScript/Effect and systems-quality reviews were clean on
  the final significant behavior diff;
- production evidence was publishable and application-purged before external
  resource deletion; and
- actual ordered deletions plus independent script and namespace absence
  checks passed.

## Closed Goal

The app delivered the approved SessionDO-finalizer-versus-facet-finalizer
communication probe, measured it within the spend ceiling, accepted its
mechanical feasibility, rejected latency promotion, preserved Postgres
authority and the uncertainty cutline, and removed every temporary Cloudflare
resource. It remains an app-local future experiment rather than a current
Flarex roadmap.
