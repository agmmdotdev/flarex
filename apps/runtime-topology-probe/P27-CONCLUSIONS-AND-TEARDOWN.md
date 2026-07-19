# P27 Conclusions And Teardown

Status: complete on 2026-07-19. The partial campaign is sealed and purged, all
temporary Cloudflare resources are absent, and only secret-free ignored local
artifacts remain.

## Decision

The experiment answers two different questions:

1. **Does warm reuse materially remove startup and cross-runtime overhead?**
   Yes, descriptively. Across the 39 successful requests, warm median
   `gateway_session_rtt` was 64 ms versus 1,850 ms cold, and warm median
   SessionDO-to-facet time was 29 ms versus 903 ms cold.
2. **Is the tested long-lived facet finalizer safe enough to promote?** No.
   Eight repeated `outcome_uncertain` failures made the campaign incomplete.
   The safe architecture conclusion is to retain Postgres terminal-outcome
   authority and not cache an unproven finalization capability across facet
   requests without a dedicated lifecycle proof.

This is useful negative evidence, not a reason to move executor authority back
to the parent Worker. Trusted platform shell code can still compile an intent,
validate OCC, and invoke the final Postgres operation from a facet when the
database capability is designed for that lifetime. User code must not receive
the capability, and facet persistence must never become a second commit
authority.

## Ordered Teardown Receipt

The runner first reconciled the incomplete campaign, wrote and reread its raw
and summary artifacts, and reached application `purged`. External teardown
then ran in order:

1. Gateway deleted-class migration removed `ProbeSessionDO`, `ProbeRunDO`, and
   `ProbeCampaignDO`, disabled workers.dev, and left only the bearer secret.
2. The bearer secret was explicitly deleted and the gateway was verified with
   zero bindings.
3. Gateway Worker was deleted.
4. Private mock Worker was deleted.
5. Sync deleted-class migration removed `ProbeSyncDO` and was verified with
   zero bindings and zero owned namespaces.
6. Sync Worker was deleted.

Final authenticated proof:

| Boundary | Result |
| --- | ---: |
| Exact probe scripts present | 0 of 3 |
| Script reads | 3 of 3 returned Cloudflare `10007` |
| Maximum-page namespace inventory | 0 rows, total 0 |
| Independent default-page namespace inventory | 0 rows, total 0 |
| Gateway secret/bindings before deletion | 0 |
| Local probe token/origin environment variables | 0 |

Historical account analytics and ignored local evidence are not live resources
and remain unstaged.

## Final Validation

- package typecheck passed;
- all 27 Vitest files and 251 tests passed on the final runtime code;
- focused 59-test validation passed;
- all five deployment bundle dry-runs and all three delete dry-runs passed;
- final TypeScript/Effect and systems-quality reviews were clean;
- the non-publishable production artifact was persisted and application-purged
  before external deletion; and
- ordered deletion plus independent script and namespace absence checks passed.

## Closed Goal

P24-P27 implemented and production-tested warm SessionDO/facet reuse, recorded
the large descriptive warm-latency reduction and the repeated uncertainty
failure, preserved Postgres authority, stayed within the approved spend, and
removed every temporary Cloudflare resource. The work remains app-local future
research and does not change an active Flarex roadmap.
