# P09 Production Smoke

Status: passed on 2026-07-18; the campaign and isolated deployment are retained
for a separately approved P10 run.

This is the sanitized production receipt for the isolated runtime-topology
probe. It records only synthetic probe state and aggregate platform evidence.
It contains no Cloudflare account identifier, account display name, OAuth
token, bearer secret, claim token, request payload, or Flarex tenant data.

## Approved Boundary

The owner confirmed that the selected account had been upgraded to Workers
Paid and retained the previously approved USD 2 maximum incremental spend.
This attempt remained inside the checked-in P09 smoke:

- one isolated sync Worker, mock Worker, and protected gateway name;
- one ordinal from each of the eight frozen scenarios;
- no P10 remaining-ordinal collection, reconciliation, evidence seal, purge,
  teardown, or Flarex architecture change; and
- no direct binding to a Flarex production resource.

Before deployment, the app passed typecheck, all 219 tests, and fresh sync,
mock, and gateway Wrangler dry-runs. The app-local source and configuration had
advanced since the failed first attempt, so those checks were rerun against the
exact deployed checkpoint.

## Ordered Deployment And Admission

1. The private sync Worker deployed with only its SQLite `ProbeSyncDO`.
2. The private mock Worker deployed with only its external `PROBE_SYNC`
   binding to the sync Worker.
3. The gateway deployed with `ProbeSessionDO`, `ProbeRunDO`, and
   `ProbeCampaignDO`; the four mock RPC entrypoints; and Worker Loader.
4. Cloudflare accepted the Worker Loader upload that attempt 1 had rejected
   with code `10195`. This is the direct runtime capability proof for the now
   eligible target.
5. A fresh high-entropy bearer capability was generated in memory and supplied
   to Wrangler through standard input. The final capability was not printed,
   passed as a command argument, written to a file, or committed. An initial
   capability was immediately rotated after an overly strict local receipt
   check rejected Cloudflare's successful `201 Created`; neither value escaped
   process memory.
6. The one planned unauthenticated request returned `401` before route
   dispatch.

Wrangler 4.100.0 completed each Cloudflare mutation but sometimes retained a
local Node process after recording command completion. Deployment success was
therefore accepted only when the sanitized Wrangler log contained the matching
Cloudflare success response and command receipt; only those probe-owned process
lineages were stopped.

## Eight-Scenario Result

The no-retry smoke path made its frozen 42 authenticated gateway requests. All
eight ordinal-zero samples reached `completed`, and the final campaign status
remained `running`:

| Scenario | Run | Caller-observed duration (ms) |
| --- | --- | ---: |
| `edge_echo` | `local_01_edge` | 241.625 |
| `session_echo` | `local_02_session` | 1,027.969 |
| `dynamic_direct_echo` | `local_03_direct_stable` | 214.460 |
| `facet_echo` | `local_04_facet_stable` | 1,052.649 |
| `facet_journal` | `local_05_journal_stable` | 1,195.724 |
| `commit_wake` | `local_06_wake` | 1,159.677 |
| `full_invoke` | `local_07_invoke_stable` | 2,114.075 |
| `sync_rerun` | `local_08_rerun_stable` | 2,042.915 |

These are single, control-plane-inclusive external round trips from a cold
production smoke. They prove reachability and bounded completion, not a latency
distribution or an architectural performance conclusion. P10 owns repeated
measurements and percentile analysis.

The ignored `.probe-state/p07b_local_v1.json` checkpoint strictly decodes as
the same campaign with eight unique ordinal-zero external completions. The
smoke runner also reread all run statuses, rejected failed or still-claimed
samples, replayed the durable external completions, and required the final
campaign to remain `running`. No optional smoke replay was needed.

## Dynamic Worker, Identity, And Budget Evidence

The exact Cloudflare GraphQL dataset used for billable Dynamic Worker counts
reported this same-day delta from the pre-attempt zero baseline:

- 5 Dynamic Worker or facet requests;
- 4 distinct Dynamic Workers; and
- 7,502 microseconds of Dynamic Worker CPU time.

That matches the five dynamic smoke scenarios and the four bounded stable code
profiles: `direct-v1`, shared `facet-v1`, `invoke-v1`, and `rerun-v1`. Strict
response decoding derives and verifies each expected code identity from the
run, scenario, dimensions, and ordinal; a mismatched identity cannot complete
the runner path.

The probe is below every included published unit: 4 versus 1,000 unique Dynamic
Workers, 5 versus 10 million requests, and 7.502 ms versus 30 million CPU ms.
Even if all included allowance had already been exhausted, applying the
published overage rates to this observed delta is approximately USD 0.008002,
well below the authorized USD 2 ceiling. Cloudflare's available OAuth APIs do
not expose an exact incremental invoice, so this is a bounded rate calculation,
not a billing receipt.

## Trace And Topology Evidence

The authenticated Worker settings API confirmed all three deployed Workers
have tracing enabled, persisted, and sampled at `1`. Each successful controlled
sample also passed the scenario-specific strict fragment schema, including its
derived identity, startup callback observations, exact nested span names,
parentage, outcomes, and sync-wake relationship.

The current Wrangler OAuth grant does not include the separate `Workers
Observability Write` permission required by Cloudflare's historical telemetry
query endpoint. That endpoint returned authentication code `10000`, so this
receipt does not claim that persisted trace rows were retrieved. This does not
replace the application-local evidence: the external root duration is durable
in the checkpoint, while P10 assembles, validates, persists, and seals the full
application trace trees. A P10 observation lane should start `wrangler tail`
before collection or use a grant with the observability permission if
Cloudflare trace corroboration is still desired.

The post-smoke inventory contains exactly the three isolated probe scripts and
four probe Durable Object namespaces. Binding direction is gateway to mock to
sync; deployment order was sync, mock, gateway. The gateway has no direct sync
binding, and no Flarex production binding is present.

## Retained State And P10 Gate

The final state is intentionally not cleanup-complete:

- the singleton campaign is `running`;
- the eight-completion ignored checkpoint remains local;
- all three Workers and four Durable Object namespaces are retained for the
  same-campaign P10 resume; completed measurement facets were deleted through
  the normal per-sample cleanup path, while P11 still owns final Worker Loader
  code-cache and deployment teardown; and
- no bearer capability remains in the local environment or filesystem. P10
  must rotate a fresh in-memory capability through Wrangler standard input.

P10 has not started. Its remaining 24 sample executions, evidence seal,
artifact persistence, and single application purge require their own current
preflight and explicit approval. P11 still owns conclusions and deployment
teardown.
