# P34 Production SessionDO-Owned Postgres Evidence

Status: complete with integrity-publishable, provenance-qualified probe
evidence on 2026-07-20. A fresh, single-version campaign completed all 32
planned production samples with no
failed scenarios, abandoned claims, missing external durations, unstarted
samples, duplicate wakes, or warmup exclusions.

This remains an app-local future-topology experiment. It does not change an
active Flarex roadmap or promote SessionDO-owned finalization into the main
executor.

## Live Boundary

The live account was freshly verified as `agmmdotdev@gmail.com`. The probe
created one random least-privilege Neon role, the isolated
`flarex_runtime_topology_probe_p28` schema, and one Hyperdrive configuration
with caching disabled, SSL required, and origin connection limit 5.

One Worker script exported routing, SessionDO, SyncDO, RunDO, CampaignDO, the
Worker Loader, and same-script control entrypoints. The Dynamic Worker received
an empty environment and blocked global outbound access. The candidate facet
made no finalization call; trusted Postgres code executed only after the facet
returned to SessionDO.

## Failure Found And Fixed

The earlier production attempt proved the candidate transaction in Neon but
returned HTTP 500 afterward. The stronger local public-gateway test exposed the
exact cause: `session_postgres_warm_invoke` was missing from the gateway
fragment relationship validator. The SessionDO commit succeeded, then schema
construction rejected the otherwise valid scenario before RunDO finalization.

The public-gateway test also corrected its campaign-creation expectation from
HTTP 200 to the protocol's HTTP 201 and preserves non-JSON response text in a
failed assertion. After the validator fix, all four disposable-Postgres tests
passed, including the complete public gateway -> RunDO -> SessionDO -> Dynamic
Worker facet -> Postgres -> SyncDO -> RunDO-finalize path.

The first corrected production smoke then exposed two parallel classifier
omissions. Candidate sync-wake evidence was absent from the RunDO status
validator and candidate claims were absent from RunDO ordered-wake enforcement;
the statistics cohort also omitted candidate SessionDO activation. Those lists
were corrected and focused tests passed.

Because the first smoke had been claimed before ordered-wake enforcement was
deployed, that RunDO could not be reused honestly. Its campaign was sealed as
non-publishable and all application state was purged. A fresh Worker/DO
generation and fresh `p32_session_postgres_ab_v4` campaign then ran entirely
under one corrected code version.

## Integrity-Complete Production Result

The final counterbalanced campaign contained eight pairs, two sequential
requests per run, and 16 samples per arm. It ran primarily in `SIN`, with the
first pair observed in `MNL`. Every sample committed exactly once, observed an
applied SyncDO wake, finalized its RunDO record, and had an external duration.
The raw evidence hash was
`abecd18472535acd59224927449f4d3ee558f36a121600b40cdcad7d739548e7`;
the sealed evidence contained 32 records with SHA-256
`8d575cab53b8698d6a403996b9c33179f39b59e7757f3a7b8de907e4210b0d48`.

The sealed v1 artifact's single `compatibilityDate` is `2026-06-14`, matching
the loaded Dynamic Worker code. The outer routing/DO/entrypoint Worker was
deployed at `2026-07-19`. The v1 target shape could not record both dates, so
the sealed artifact has a runtime-provenance ambiguity even though its
completeness/integrity flag is publishable. The artifact and hashes were not
silently rewritten after teardown. The strict v1 target shape remains frozen;
future production runs that need both dates must use artifact v2 or a
separately versioned provenance companion sourced from deployment config.

Nearest-rank aggregate latency in milliseconds:

| Boundary | Facet -> entrypoint control, median / p95 | SessionDO candidate, median / p95 |
| --- | ---: | ---: |
| external request, all 16 | 1674.766 / 3031.176 | 609.995 / 2176.523 |
| external request, ordinal 1 only | 271.877 / 1674.766 | 251.349 / 609.995 |
| gateway -> SessionDO | 1531 / 2688 | 478 / 1892 |
| commit-host boundary | 626 / 1174 | 54 / 895 |
| Postgres transaction | 38 / 577 | 38 / 43 |

For the 16 position- and ordinal-matched pairs, candidate minus control external
latency had a median of -76.879 ms and a mean of -214.209 ms. For the eight
second sequential requests, the paired median was -37.439 ms and the mean was
-154.528 ms. Negative means the SessionDO candidate was faster.

Ordinal 1 is a warm opportunity, not proof that every Cloudflare component
remained resident: callback observations show that some Worker Loader, facet,
or SessionDO activations ran again. The sample is intentionally small and its
tail includes cold/rescheduling effects. The reliable conclusion is therefore
about this bounded topology probe, not a universal latency guarantee.

## Decision

Subject to that provenance qualification, the experiment supports keeping
routing in the public Worker, user code in the
network-isolated Dynamic Worker facet, and trusted OCC/final Postgres commit in
SessionDO after the facet returns. In this deployment that removed the
same-script entrypoint hop without mixing trusted commit code into the Dynamic
Worker and improved the measured end-to-end distribution.

The database transaction median itself did not change; the improvement came
from the surrounding commit-host and request path. SyncDO notification remains
post-commit trusted work. PostgreSQL remains the authority for fencing,
transaction outcome, cursor advance, and exact terminal-outcome recovery.

This is evidence for a later architecture decision, not a current-roadmap
change. A production implementation still needs the main executor's real OCC,
commit compiler, failure recovery, and operational limits rather than the
probe's synthetic journal.
