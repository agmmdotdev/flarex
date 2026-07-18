# P11 Conclusions And Teardown

Status: complete on 2026-07-18. The isolated experiment is closed, every
probe-owned Cloudflare Worker and Durable Object namespace is absent, and the
accepted Flarex architecture roadmap was not changed.

## What The Probe Supports

The production run supports these narrow conclusions:

1. A normal Worker can route through a SQLite SessionDO supervisor into a
   dynamically loaded Durable Object facet, return a sealed synthetic journal,
   call a private mock-finish Worker, wake a separate sync Durable Object, and
   accept a one-shot reverse rerun capability without a permanent reverse
   service binding.
2. In this tiny run, the direct Dynamic Worker call (5-13 ms), ordinary facet
   hop (3-29 ms), and two-entry facet journal I/O (4-12 ms) were not the largest
   measured spans. SessionDO routing, mock-to-sync wake, the rerun path, and the
   outer claim/finalize/control request showed much more latency and variance.
3. A fresh facet identity per attempt plus explicit `facets.delete()` worked
   for normal completion, and the application purge completed before namespace
   deletion. This does not make a lost JavaScript call stack resumable.
4. The original billing model was wrong. The production P10 interval reported
   32 Dynamic Worker requests for 18 logical remaining dynamic/facet samples.
   Future facet probes must budget at least two metered requests per facet
   sample until a dedicated billing test proves a smaller bound.

The detailed evidence, percentiles, digests, cohort caveats, and cost
calculation are in
[`P10-PRODUCTION-EVIDENCE.md`](./P10-PRODUCTION-EVIDENCE.md).

## What The Probe Does Not Support

This experiment contains no Postgres snapshot, OCC validation, commit
compiler, authoritative outcome, transaction, durable outbox, gap recovery,
real deployment state, or client subscription delivery. It therefore does not
support moving executor, OCC, or commit authority into SessionDO. The tested
ownership remains:

```text
gateway / trusted host coordination
  -> non-authoritative SessionDO supervisor
  -> attempt-scoped Dynamic Worker facet and temporary SQLite journal
  -> trusted mock commit boundary
  -> non-authoritative sync wake analogue
```

For a real Flarex design, Postgres remains the only authoritative committed
app-data store. A SessionDO may later coordinate an attempt and a facet may
produce a bounded journal or commit intent, but neither becomes the final
committer merely because communication is possible.

## Follow-Up Decision

A later real `C07A` comparison is worth running only after the Postgres-backed
execution baseline exists. It should compare the same deterministic function
and artifact against:

- a Postgres-authoritative journal/commit-intent path; and
- an attempt-scoped facet journal whose exact artifact and attempt fence are
  pinned by the authoritative session anchor.

That comparison should measure the topology spans directly, remove campaign
control work from the timed request, balance colos, use materially larger
cohorts, vary payload and journal size independently, and budget the observed
two-request facet behavior. This is a future experiment recommendation, not a
promotion of SessionDO/facets into the current Flarex roadmap.

## Ordered Teardown Receipt

Evidence preservation and application purge were proven before any class
deletion migration. The raw artifact remains an `evidence-sealed` pre-purge
snapshot by design; the successful runner receipt separately returned
`purgeState: "purged"`, which requires all campaign purge tasks to be complete.

The external teardown then ran in dependency order:

1. The gateway teardown config deployed migration
   `v4-delete-probe-state`, removed `ProbeSessionDO`, `ProbeRunDO`, and
   `ProbeCampaignDO`, disabled workers.dev, and removed every Worker Loader,
   service, and Durable Object binding.
2. Cloudflare preserved `RUNTIME_TOPOLOGY_PROBE_TOKEN` when the ordinary
   teardown deployment omitted it. The secret was explicitly deleted, and a
   fresh settings read proved the teardown Worker had zero bindings.
3. The gateway Worker was deleted and its script-list, namespace, settings,
   subdomain, and secret absence was verified.
4. The private mock Worker was deleted, removing all four mock entrypoints and
   the only external `PROBE_SYNC` binding. Its absence was verified before the
   sync migration.
5. The sync teardown config deployed migration
   `v2-delete-probe-state`, removed `ProbeSyncDO`, and produced a Worker with
   zero bindings. Two namespace-list reads both returned an empty inventory.
6. The sync Worker was deleted.

Wrangler 4.100.0 dispatched the mutations but repeatedly retained its local
Node process without returning console output. No mutation was blindly
repeated. Each retained process was stopped after a bounded wait, and the next
step ran only after the authenticated Cloudflare API proved the expected new
state.

## Final Absence Proof

The final authenticated receipt proved:

| Boundary | Result |
| --- | ---: |
| Exact probe scripts present | 0 of 3 |
| Exact probe namespace pairs present | 0 of 4 |
| Maximum-page namespace result | 0 rows, total 0 |
| Independent default-page namespace result | 0 rows, total 0 |
| Deleted-script settings/subdomain/secrets checks | 9 of 9 returned HTTP `404`, Cloudflare code `10007` |
| Local probe token/origin environment variables | 0 |

The ignored raw artifact, summary, and checkpoint are intentionally retained
locally as synthetic, secret-free audit evidence. They are not deployed,
staged, or committed. Historical account-level Dynamic Worker analytics remain
visible after teardown; that immutable usage history is not a live resource.

Cloudflare's namespace API omitted optional `total_pages` even while the live
inventory contained four and later one namespace. The original P08 verifier
rule that required that optional field was therefore corrected: when absent,
the verifier derives the page count from `ceil(total_count / per_page)`, checks
every page and unique namespace ID, and independently compares a default-page
read when the complete inventory fits on one page.

## Final Local Validation

- package typecheck passed;
- all 27 test files and 220 tests passed;
- gateway and sync teardown bundles passed fresh binding-free Wrangler
  dry-runs;
- the ignored artifacts passed the app's strict schema, canonical-manifest,
  raw/summary, durable-evidence, and derived-summary checks; and
- the app-only Markdown diff passed Git whitespace/error checking.

## Closed Goal

The app delivered the requested isolated production communication and latency
probe, preserved publishable evidence, recorded the model correction and
architecture limits, removed every external probe resource, and kept all
design conclusions inside `apps/runtime-topology-probe`. No active Flarex
roadmap, executor, OCC, compiler, persistence, or sync implementation was
changed by this experiment.
