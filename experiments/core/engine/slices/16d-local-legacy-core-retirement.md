# Local legacy core retirement

Status: **Isolated experiment and obsolete stored-format compatibility retired;
remaining functional caller migrations open.**

The owner confirms there is no live database or retained deployment data: only
this local repository. Old-format data migration is therefore unnecessary.
Supported Application, Payload, Medusa, Task and sync behavior must survive;
remaining runtime callers move before their implementation or schema disappears.
Work stays in the shared checkout and preserves unrelated changes.

## Connected removal boundary

Independent current-owner, accepted-direction and pinned-Convex challenges agree
on the first removal boundary. The source remains
`db914cf06e2b06ee985646611b9e12ed7a770318`; its PostgreSQL `init_sql`, lease
precondition/acquisition and persistence loading mechanisms require the current
five-table owner, not the isolated prototype or old application metadata codecs.
No mechanism divergence is introduced by retiring these unneeded formats.

| Previous responsibility | Current owner and disposition |
| --- | --- |
| Isolated `experiments/core/src` candidate and its own Drizzle schema, tests and package/tooling | Remove the executable closure. Existing measurement notes and source hashes remain frozen historical evidence; Git preserves the implementation. Current package owners are the only engine to extend. |
| c554 catalog decoding, bootstrap conversion and table-summary cutover selection | Load the current registry directly. Preserve current historical snapshots, `table_summary_v2` checkpoints and exact revision replay. Remove only obsolete-format conversion and its fixtures. |
| Pre09 stored-program identity framing | Keep the current producer's closed envelope, canonical frames and publication/authority checks; reject the obsolete envelope. Remove its old decoder and fixture. |
| Application deployment metadata moved from `_schemas` to `_programs` at startup | Fresh registration already writes current records. Remove the one-way upgrader and its dedicated tests; retain current candidate/publication/abandon/upgrade/race coverage. |

## Behavioral coverage retained

The experiment's Application pending reads, misses, OCC, replay and uncertain
outcomes are covered at the actual current owners by `bootstrapScenarios`,
`applicationQueryScenarios`, `applicationOwnerScenarios`, `indexCacheScenarios`
and index-snapshot tests. Native rollback, sticky failures, concurrent winners,
lost acknowledgements and cancellation are covered by `core-atomic-workflow`
and `core-product-sticky`. Payload replay, uncertainty and caught uniqueness
remain in `core-payload-native-durability-scenarios`, with native drain and full
Cause boundary coverage at their owning lifetimes.

Prototype SQL guards, scalar scope-clock acceptance, batched absent-ID SQL-count
contracts and equality fingerprint algorithms are displaced implementation
contracts. They do not transfer to the translated core. Frozen experiment
results establish only their recorded historical observations; they do not
establish current performance, and cleanup does not start a performance run.

Fresh bootstrap anchors, fenced atomic persistence, strict current metadata,
native registry authentication, cold reconstruction, exact outcome recovery and
current-format historical reads remain required. Physical baseline maintenance
is distinct from old logical decoding: preserve its data/replay guarantees using
current logical records rather than requiring obsolete catalog conversion.

## Remaining caller migrations

The old executor registry/transport, query-sync readers, Task lifecycle, finite
Payload/native participants and legacy installation owners still have code
callers. Their schemas are not retained for hypothetical data. They can retire
when those callers execute through the translated owners with their supported
behavior and meaningful coverage intact. The [consumer ledger](./16b-legacy-entrypoint-retirement.md)
continues to identify these connected migrations. An old fixture or export
alone does not establish a supported feature.

The [sync source contract](../../../../roadmaps/query-sync-engine/preflight/16-translated-core-source-retirement.md)
records the owner's explicit selection of pinned Convex log/retention semantics
instead of the former dense feed's extra missing-commit corruption check. Its
fixed-target Core source proof precedes the actual baseline host cutover;
selecting that contract alone does not retire functional callers.
