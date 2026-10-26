# Native Product construction slice

Status: bounded native scalar-update binding implemented. Active Medusa
integration remains unchanged. This is not general Product compatibility.
The ongoing goal adds Payload CRUD, representative Product flows and an explicit
Application/Product/Payload mixed measurement; this slice establishes the first
real Product binding before widening those contracts.

## Reuse inventory

| Connected owner | Disposition and reason | Witness |
| --- | --- | --- |
| Promoted ProductModuleService.updateProducts and native internal service | Reuse actual implementations, including retrieval, normalization, replacement fallback, serialization and event decorators | Complete title update, missing-row error, native output and event |
| Existing compileProductDefinition and compileCompleteRow | Reuse checked DML compilation and complete scalar decoding; neither opens an active execution host | Every native column retained; nullable/boolean/metadata values decoded |
| Existing prepareCommerceInternalService | Reuse immutable native class preparation and repository injection after its dependency audit | Actual native service calls reach the experimental DAL |
| Current Product repository, manager bridge, module use and command host | Replace their old-core coupling inside this folder; do not emulate CommerceCommandContext or import its working set | One experimental command/root; no child settlement or per-native-method admission |
| Pending rows, uniqueness, original versions and materialization | Extend the shared experimental owners, not an adapter-local storage engine | Scalar updates, stale-write rejection and atomic row/history/outcome |
| Native event subscriber/aggregator and bus contract | Reuse native production of events; translate and retain intents in the shared accepting transaction | Single native product.product.updated, no event on rollback/replay |

The executing source is the promoted fork recorded in third_party/medusa/SOURCE.json,
with local executing bytes fingerprinted for comparisons. Native algorithms are
not copied. The pinned Convex read/write ownership reference remains applicable;
the direct framework profile does not acquire Application predicate OCC or retry.

## Initial admitted operation

Start with a title update by existing Product ID in a relation-free disposable
installation. Preserve the complete native scalar record, native normalization,
ordinary NOT_FOUND behavior, requested empty relations and emitted event. This
profile cannot import Products with associations, mutate managed fields, create
child relations, soft-delete, execute workflows or issue remote effects. Empty
relations follow the closed installation's writer set; they are not fabricated
answers over an unexamined active database. Broader Product flows need their
actual relation/index/reference owners and connected witnesses.

The mutation result follows the native update's loaded relation projection:
options and tags are empty, collection and type are null; untouched images,
variants and categories are absent. The optional native comparison validates
every returned key/value except independent installation timestamps, which are
validated separately. Replacement capabilities do not imply populated output.
The result owner composes complete DML scalar decoding with that closed loaded
relation projection for live results, committed replay and response-loss recovery.
Prepared updates also run against callback-scoped mixed roots without opening or
settling another command; the native service and event implementation are shared.

One direct command opens a durable reservation. Its root caches original row
observations and owns all pending changes across native DAL calls. First reads
are freshly authorized; repeated native reads use detached copies of that same
observation. Settlement freshly checks authority, selected definitions, database
time and write predecessors under scope order, then publishes rows/history,
constraints, native event intents and outcome atomically. Caught integrity or
authority failures poison the root. There is no automatic framework replay.
No physical transaction spans the native service or callback.

The shared definition codec now supports nullable scalar and JSON framework
columns. Standalone Application admission still refuses those additional field
kinds until its own value/codec contract is expanded. Shared metadata support
does not silently broaden the Application profile.

## Completion and measurement gates

The next matched Product graph is the existing complete native
update/retrieve/list-by-handle sequence, not a raw method timing or an invented
Product workflow. Reuse the text-equality query owner needed by
[Payload cleanup](./PAYLOAD-CRUD.md) for historical/pending handle membership.
Its list result requires complete native rows; preference deletion requires only
identities/predecessors. Share selection/invalidation mechanics while keeping
those result demands explicit. Native service methods and their default query
construction remain authoritative. Neither this sequence nor growing batches
establishes child relation, Pricing/Link or workflow-launch compatibility.

Prove PGlite and ordinary-role PostgreSQL results, pending state, native events,
rollback, revocation, stale writes, identity/replay, cancellation/draining and
shared Payload/Application regressions. Capture actual SQL/session counts and
complete request timings against the executing native flow; preserve the active
comparison setup blocker rather than bypassing it. Batch, query shape, unrelated
schema and same-scope contention gates remain required before coverage expansion.
The opt-in genuine native Product comparison currently proves shape/value parity,
not timing. This bounded slice alone cannot decide the whole redesign or establish
deployment. The [bounded mixed connection](./MIXED.md) now composes this operation
with actual Application and Payload entry points. Payload CRUD, broader Product
flows and matched measurements remain open under the active experimental goal.
