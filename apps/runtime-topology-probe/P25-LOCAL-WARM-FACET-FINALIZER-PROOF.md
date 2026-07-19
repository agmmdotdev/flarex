# P25 Local Warm Facet Finalizer Proof

Status: complete on 2026-07-19. Implementation, full local runtime proof,
deployment/teardown dry-runs, and both mandatory reviews are green.

## Implemented Boundary

The `facet_finalizer_warm_invoke` scenario derives a unique `attemptId` for
every request and one stable `facetId` for all eleven requests in a run. The
SessionDO retains that facet after settled outcomes, while the generated facet
shell keys its durable terminal rows by attempt and transactionally replaces
the operation-local execution tables before every finalization.

An in-memory SessionDO activation marker records whether the current request is
the first warm-finalizer operation handled by this activation. The public
sample preserves that observation beside the existing facet-startup and Worker
Loader callback observations. Historical artifacts remain decodable because
the new public observation and facet identity field are optional outside the
strict internal invoke protocol.

## Local Proof

The real bundled Miniflare graph executes two sequential public requests and
two direct internal requests through the same SessionDO and facet. It proves:

- request one reports SessionDO activation, facet startup, and Worker Loader
  callback execution;
- request two reports no new activation and neither startup callback;
- both receipts carry the same `facetId` and different `attemptId` values;
- journal seals and result digests differ between the attempts;
- SyncDO advances from zero to one and then one to two;
- replaying request two returns its byte-identical response without a second
  cursor advance;
- changing request two under the same attempt fence is rejected; and
- purge deletes the one retained shared facet and replays idempotently.

The frozen matrix regression pins eight run cells, 88 sequential requests,
5,632 payload bytes, 176 logical journal entries, eight code/facet identities,
and 24 cleanup tasks (eight sessions, eight sync scopes, and eight runs).
Statistics include SessionDO activation in the cohort key, so first-request and
warm-reuse durations cannot be accidentally combined.

## Current Local Receipt

- package typecheck green;
- all 27 Vitest files and 251 tests green; and
- focused generated-facet, public gateway, replay/conflict, statistics, trace,
  campaign-budget, and purge behavior green;
- sync, mock, gateway, gateway-teardown, and sync-teardown bundle dry-runs
  green, together with all three delete dry-runs; and
- final TypeScript/Effect and systems-quality reviews clean.

Production evidence is not claimed here.

## Explicit Non-Proof

Warm facet reuse does not make a lost JavaScript call stack resumable and does
not make facet SQLite authoritative. A real Flarex implementation must keep the
attempt/session fence and terminal mutation outcome in the same Postgres
transaction as application writes, then resolve an uncertain external outcome
from Postgres rather than from facet-local state.
