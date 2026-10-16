# Composite Key Reverse Access

Status: implemented private shared access correction with neutral and native
consumer proofs. Existing populated-installation upgrades and hosted activation
remain separately gated.

## Failure And Owner

The native Stock Location deletion workflow returns actual deleted identities
and passes them to the genuine Link router. Its retained compensation restores
Sales Channel–Stock Location pivots by `stock_location_id`, including deleted
rows. That native Link has a composite identity `(sales_channel_id,
stock_location_id)` and an active-only reverse index. The shared relational
query owner correctly refused that all-row reverse selection as unindexed.
The preserved failure witness had indexed forward deletion and refused
restoration/all-row reverse reads before mutation; the derived path closes it.

Shared logical storage already derives unconditional reverse access for native
single-column foreign keys. Native rich Links deliberately retain their native
missing-endpoint behavior and therefore declare no foreign-key constraint.
Their reverse access requirement does not grant endpoint integrity, cascade or
mutation authority. The correction belongs to shared access derivation,
projection/build requirements, bound read metadata and settlement—not an
adapter-local scan, extra transaction or native business rewrite.

## Contract

Derive unconditional reverse access for text components after the leading
column of composite native keys when no unconditional declared prefix covers
that field. Reuse the existing physical ordered-index family, index build and
coverage proofs, selected metadata and finite dependency owners. One derived
path covers a field; preserve existing foreign-key reverse path identities.
Name new composite-key paths distinctly. Keep native partial indexes and their
predicates unchanged. Do not relax query admission or use a prefix index as if
it indexed a suffix. An eligible native partial index retains its null anchor
ahead of derived reverse access, so active queries do not acquire deleted
history. Declared unconditional native prefixes retain their existing priority.

No native relational schema, source lineage, physical table or durable data is
deleted or reset. Fresh configured candidates build the derived path through
the existing requirement and initialization owners. An existing installation
must satisfy the new exact access projection/build requirements before serving
that path. Missing, stale or incomplete coverage must refuse; this scope does
not supply a populated-data conversion or general backfill orchestration API.
Do not claim old installations were upgraded implicitly.

## Verification And Reassessment

Prove the derivation with neutral composite keys and existing foreign-key paths,
unconditional-prefix deduplication, partial-index preservation and non-text
refusal. Both PGlite and ordinary-role PostgreSQL prove all-row reverse
reads across active/deleted rows, pending lifecycle visibility, bounded closure,
rollback and scope confinement. Missing access/build evidence remains a refused
operation. The selected real ordered-index definition and a mixed-history
identity bound distinguish active-only access from all-row access. These bounded
proofs do not establish a general query-performance or scale claim.

Regress shared requirement/projection/selected-read owners and native Stock
Location deletion/compensation, Sales Channel deletion, Product Link lifecycle
and affected Inventory/Stock Location consumers. Keep resource limits,
settlement, publication and framework compatibility profiles unchanged.

When a richer relation model replaces the native-key derivation, migrate its
existing requirements, access metadata, projections and consumers in one
connected correction. A reverse index remains derived access, never a second
authoritative record.
