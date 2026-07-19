# P30 Production Postgres And Hyperdrive Evidence

Status: bounded production execution complete on 2026-07-19; result is useful
but deliberately non-publishable under the P28 mechanical gate.

## Production Topology Proved

The authenticated `agmmdotdev` Cloudflare account executed:

```text
collector -> gateway Worker -> SessionDO -> reused Dynamic Worker facet
  -> private Postgres Worker -> request-scoped pg.Client
  -> cache-disabled Hyperdrive -> direct Singapore Neon transaction
  -> SyncDO wake
```

Cloudflare control-plane output proved the Postgres Worker had only the
cache-disabled Hyperdrive binding and SyncDO namespace. Hyperdrive used the
direct Neon endpoint, TLS require, the generated probe role, and a five-origin-
connection ceiling. A direct database inspection proved terminal outcome rows
and ordered cursor advancement in Neon.

## Campaign Integrity

Both arms used eight series, six ordered calls per series, stable code, one
reused SessionDO/facet per series, concurrency one, 64 payload bytes, and two
journal entries.

| Arm | Planned | Observed | Successful | Failed | Not started |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mock finalizer | 48 | 46 | 39 | 7 | 2 |
| Postgres/Hyperdrive | 48 | 44 | 37 | 7 | 4 |

Both sealed evidence artifacts are non-publishable because every planned call
did not complete successfully. The seven failure count is identical across
arms and matches the already-known facet-finalizer outcome-uncertain boundary.
It is not evidence of a Postgres regression. Latency below uses successful
samples only.

This run used the pre-review shared warm-finalizer scenario and did not yet
contain the exact Postgres outcome-resolution RPC. Mandatory review of the
captured failures produced a local hardening follow-up: the final source uses a
distinct Postgres-authority scenario, resolves exact terminal outcomes after
response loss or pre-commit failure, serializes the duplicate decision behind
the scope lock, safely reruns interrupted pre-finalization facet work, and
separates outcome-resolution timing from commit timing without zero-valued
placeholder spans.
Those corrections were validated locally but were not redeployed, so they do
not retroactively make this evidence publishable.

The production execution did not wait the planned 90-second post-deployment
propagation gate. It is therefore an exploratory production result, not a
release threshold or a claim about steady-state global traffic.

## Clean Warm Comparison

The clean warm cohort requires both Worker Loader and facet startup callbacks
not to run. Each arm had 24 such successful samples.

| Span | Mock median / p95 | Postgres median / p95 | Targeted interpretation |
| --- | ---: | ---: | --- |
| External request | 527.5 / 667.8 ms | 311.7 / 719.8 ms | Not causally attributable; Internet and rollout timing differed |
| Gateway to SessionDO | 184 / 308 ms | 146 / 236 ms | Host/runtime variation, not database-only |
| Session snapshot read | 0 / 0 ms | 32 / 39 ms | Real Hyperdrive/Postgres read cost |
| SessionDO to facet | 29 / 194 ms | 73 / 94 ms | Includes facet work and finalization |
| Facet atomic finalization | 15 / 47 ms | 60 / 72 ms | Parent duration for finish RPC |
| Postgres transaction | 0 / 0 ms | 48 / 57 ms | Real transaction, including request-scoped client lifecycle |
| Post-commit SyncDO wake | 15 / 47 ms | 13 / 18 ms | Similar after warmup |
| SyncDO cursor operation | 4 / 38 ms | 3 / 5 ms | Similar after warmup |

The targeted warm overhead is approximately 32 ms for the authoritative read
plus 48 ms for the transaction. Do not add the child transaction and SyncDO
durations to `facet_atomic_commit_rtt`; that span is their measured parent.

The lower Postgres-arm external median does **not** mean Postgres made the
request faster. External and gateway medians moved in the opposite direction
because the arms ran sequentially under different network/runtime conditions.
The causal result is the new approximately 80 ms of warm authoritative database
work, not the external delta.

## Cold Comparison

Eight successful cold calls per arm ran both startup callbacks.

| Span | Mock median | Postgres median |
| --- | ---: | ---: |
| External request | 2325.5 ms | 2143.3 ms |
| Gateway to SessionDO | 1943 ms | 1929 ms |
| Session snapshot read | 76 ms | 160 ms |
| SessionDO to facet | 868 ms | 900 ms |
| Facet atomic finalization | 845 ms | 876 ms |
| Postgres transaction | 0 ms | 48 ms |
| Post-commit SyncDO wake | 845 ms | 826 ms |

Cold startup dominates the transaction. This reinforces the earlier conclusion:
SessionDO/facet reuse matters much more than optimizing a roughly 48 ms warm
transaction, but the transaction cost is real and must remain visible.

## Decision

The topology is technically viable: a trusted facet shell can call a narrow
private finalizer, Hyperdrive can reach authoritative Neon, one transaction can
fence the attempt and cursor, and SyncDO can be notified only after commit.

This does not yet justify moving the main executor into a facet. Before any
roadmap proposal, a fresh production campaign must validate the now-implemented
outcome lookup/replay path, randomize or interleave paired arms, obey a stable
propagation gate, and make application purge remove Postgres probe rows before
resource teardown.
