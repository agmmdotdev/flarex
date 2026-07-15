# P09 Production Attempt 1

Status: stopped before gateway creation; cleanup verified; no latency evidence.

This is the sanitized receipt for the first isolated production attempt on
2026-07-15. It records target eligibility, the stop decision, and cleanup. It
contains no account identifier, email, workers.dev subdomain, OAuth token,
secret, or account resource inventory and changes no Flarex architecture
decision.

## Authorized Boundary

The owner authorized at most USD 2 of incremental Cloudflare spend for the
frozen probe. That authorization excluded a subscription purchase, plan change,
usage-model change, unrelated workload, and expansion beyond the checked-in
matrix and retry ceilings.

Before mutation, the task reverified:

- exactly one authenticated account with the required Worker permissions;
- a configured workers.dev subdomain and Standard default usage model;
- zero current Dynamic Worker usage in the available GraphQL analytics window;
- absence of all three prefixed Worker names;
- unchanged published Dynamic Worker, Worker, Durable Object, and trace rates;
  and
- successful fresh dry-runs for sync, mock, and gateway bundles with only the
  intended isolated bindings.

## Ordered Attempt And Stop

1. The private sync Worker deployed with only its SQLite `ProbeSyncDO` binding.
2. The private mock Worker deployed with only its external binding to that sync
   class.
3. The gateway upload was rejected before creation with Cloudflare API code
   `10195`, stating that Dynamic Workers require switching to a paid plan.
4. The experiment stopped immediately. It did not purchase or change a plan,
   install the gateway bearer secret, send a gateway request, create a campaign,
   instantiate a SessionDO or facet, invoke a Dynamic Worker, or collect traces
   or latency samples.

This response disproved the preflight inference that
`default_usage_model: standard` demonstrated Workers Paid eligibility. The
[Workers pricing documentation](https://developers.cloudflare.com/workers/platform/pricing/)
states that Paid accounts have access to Standard; it does not state the
converse. A future run requires direct subscription or dashboard evidence for
an already eligible Workers Paid target before uploading any Worker.

## Cleanup And Absence Proof

Cleanup followed the dependency order frozen in
[`P08-PRODUCTION-PREFLIGHT.md`](./P08-PRODUCTION-PREFLIGHT.md):

1. The gateway name returned `10007` (`Worker does not exist`). Because it was
   never deployed, no gateway deletion migration or script deletion was run.
2. The mock Worker was deleted, then independently returned `10007`.
3. The binding-free sync teardown Worker was deployed with the
   `ProbeSyncDO` deleted-class migration.
4. The sync Worker settings reported zero bindings.
5. The account Durable Object Namespace List API returned `success=true`, an
   empty result, page 1, `per_page=1000`, and `total_count=0`. For an empty
   account Cloudflare omitted the optional `total_pages`; a second default-page
   request independently returned the same authoritative zero total.
6. The sync Worker was deleted. All three Worker names then returned `10007`.
7. The final maximum-page namespace request still reported zero namespaces and
   therefore zero matching gateway or sync class/script pairs.
8. GraphQL analytics still reported zero Dynamic Worker usage. Local
   `.probe-state/` and `.probe-output/` directories and the local bearer-token
   environment variable were absent.

No campaign existed, so there was no application purge or evidence artifact to
preserve. The exact incremental invoice cannot be derived from the available
OAuth APIs, but no Dynamic Worker was created or invoked.

## Result And Resume Condition

This attempt produced no runtime-topology latency result. It proves only that:

- the ordered private sync/mock deployment and fail-closed cleanup path work on
  the selected account;
- a Standard default usage-model setting is insufficient Paid eligibility
  evidence; and
- the app returns to a clean remote and local state after a pre-gateway stop.

P09 remains incomplete. Resume only after identifying an already eligible
Workers Paid target, proving that eligibility directly, rechecking all three
names and the current pricing model, and confirming that the existing USD 2
incremental experiment ceiling still applies. Purchasing or changing a
subscription requires separate user authorization.
