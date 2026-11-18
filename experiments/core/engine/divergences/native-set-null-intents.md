# Native explicit set-null intents

Status: **Challenged bounded replacement implemented with paired owner and
genuine Type/Collection workflow proof; broader FK actions remain gated.**
Owner: [ordinary native workflows](../slices/17-native-atomic-workflows-and-tax.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` ordinary document
deletion does not provide ORM FK actions or an explicit native set-null receipt.
Keep its shared pending writes, exact index dependencies, final transaction and
acceptance owners. Product Type/Collection deletion requires its genuine native
detach semantics and authentic call/event/cohort validation above that engine.

The existing native lifecycle collects descriptors before applying deletion but
calls `ctx.planSetNull` after actual parent deletion. The old shared owner accepts
at most 16 distinct intents per authenticated source, each for a declared nullable scalar noAction FK and
one actual deleted target. It refuses replacement coexistence, earlier source
edits referencing that target and borrowed overlays, then seals source DAL use.
The old publisher derives child patches later. Native call evidence contains
parent deletion and set-null intent, not fabricated child Product updates/events.

The ordinary atomic owner had a separate working set per source. Its set-null
seal is source-local; unrelated source reads/writes remain allowed. The existing
reference-replacement global seal has a different contract and stays global.

Translate that responsibility into the existing Core FK/pending owner. Authenticate
the selected command's declared set-null/managed-update policy, actual source/FK/
deleted native key and issued operation context. Queue the authentic intent after
deletion, retain the source seal and existing bounds, then prepare bounded incoming
null patches through the actual ordinary index/observation and shared write owner.
Prepare/freeze before event/result sealing; final acceptance validates the frozen
graph. New incoming members after preparation conflict rather than silently widen
the graph, following the accepted Native16 frozen-closure contract. Preserve
managed timestamps and ordinary revision/index maintenance.

Derived patches are shared integrity work, not additional native callback calls
or synthetic events. The native activity owner projects actual issued intents;
it must not infer them from arbitrary hook writes or duplicate queries. Do not
route this through replacement sealing, use adapter SQL/receipts, introduce a
second working set/transaction, replay native hooks, weaken noAction or clear
sticky failure.

Prove missing/foreign/forged intent, wrong FK/nullability/target, nondeleted or
replaced target, earlier referencing edits, multiple intents/bounds and source
use after seal. Through actual Type/Collection workflows, verify detached child
rows, managed update, native call/event/cohort meaning and complete rollback.
Race new incoming references between prepared closure and final acceptance;
show conflict/refusal without callback replay or extra native child events.
Use both database lanes and preserve ordinary Product/Links noAction/FK tests.
This enables no general SQL SET NULL or arbitrary mixed-profile capability.

The [Core transaction owner](../../../../packages/persistence-postgres/src/core/transaction.ts)
authenticates `planSetNullReferences`, seals only the selected source, and prepares
the frozen child patches through ordinary indexes before result/event sealing.
Its [activity owner](../../../../packages/persistence-postgres/src/core/nativeActivity.ts)
records issued intents, while the
[native Store](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeStore.ts)
projects the selected invocation capability without inventing child calls/events.
