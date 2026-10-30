# Drizzle-owned physical definition with explicit maintenance authority

Design status: **Accepted platform maintenance boundary**.
Implementation status: **Generated baseline, strict loading and explicit c554 adoption implemented**.
Measurement status: **Supported baseline and c554 adoption validated on both database lanes; general upgrades remain unclaimed**.

The [shared schema slice](../slices/07-shared-schema-lifecycle.md) owns the
physical platform lane. Pinned Convex
`db914cf06e2b06ee985646611b9e12ed7a770318:crates/postgres/src/sql.rs` defines the
five physical tables in one initialization source. PostgresPersistence::with_pool
initializes them before acquiring its lease; optional loading defers physical
indexes to finish_loading. Logical `_schemas` and model migrations are separate.

Flarex uses Drizzle for the translated physical schema and separates privileged
platform maintenance from restricted DO serving credentials. Starting a runtime
must not grant it schema DDL capability. The preceding declaration, custom fresh
DDL and legacy Drizzle Kit configuration drifted as separate owners.
Consolidation must make declaration, generated SQL and actual inspected target
agree, keeping exactly the five base families and platform format/progress
metadata within their responsible owner.

Generate physical artifacts through the installed Drizzle tooling and consume
them from the explicit maintenance entry point. Runtime target loading verifies
the supported format and performs no DDL. Physical upgrade/version work stays
outside untrusted callbacks and is atomic or has explicit bounded durable
progress; unsupported formats are refused. No per-app/model SQL family or
framework-specific migration engine is added.

Retain the old physical migration path only for named legacy native consumers
and their data until cutover; it is not a fallback for the translated target.
Logical schema changes and producer business conversions never invoke physical
DDL. Prove generated/declaration/catalog agreement, fresh install/replay,
supported upgrade/data preservation, refusal/rollback and no ordinary-role DDL
on both PGlite and actual PostgreSQL. This record does not infer an arbitrary
old/new physical migration or authorize unnamed data deletion.

The canonical declaration now feeds the installed Drizzle generator through
`buildCorePersistenceLayout.ts`. Default database generate/check commands use
this owner, and emitted SQL, snapshot, journal and runtime layout are checked
against it. Fresh maintenance consumes that generated SQL atomically; ordinary
loading inspects the complete five-table catalog and managed baseline metadata
with SELECTs only. Explicit `adoptCorePersistenceAfterDrain` verifies the c554
shape, locks/fences lease generations and records an adopted baseline atomically.
Replay verifies that baseline without fencing a newly reconstructed owner again.
The baseline record lives in reserved `persistence_globals` rows; no sixth table
or per-framework physical family is introduced. General future physical upgrade
chains are not claimed by this supported baseline adoption.