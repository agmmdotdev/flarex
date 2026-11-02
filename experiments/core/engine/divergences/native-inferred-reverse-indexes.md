# Native inferred reverse indexes

Status: **Implemented native schema-lowering adaptation with paired owner and
genuine history and complete selected consumer proof. Wider lifecycle gates
remain open.**

Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.
The [selected Inventory/Variant continuation](../slices/19-native-inventory-and-variant-read-workflows.md)
owns its concrete consumer closure and completion gates.

## Required difference

Convex ordinary schema indexes declare their indexed fields explicitly. The
existing native relational protocol additionally admits inferred unconditional
text reverse access for suffix components of composite primary keys through
`relationalReverseIndexes`. Native Link complete-history reads rely on that
admitted selective access even when their declared secondary index is active-only.

For rich VariantInventory Links, complete Inventory-endpoint history selects
`inventory_item_id` without `deleted_at`. Primary `[variant_id, inventory_item_id]`
and conditional `[deleted_at, inventory_item_id]` cannot anchor that selection.
Omitting the inferred path makes Core hydrate a whole-table interval, charging
unrelated endpoints and widening dependencies. An isolated small fixture does
not establish equivalent capacity or conflict behavior.

## Translation and owner

Translate this authenticated native access into an ordinary Source index before
shared installation. `lowerCoreNativeRelationalSchema` consumes the existing
protocol derivation after existing FK lowering. Reuse actual emitted indexes
only when the requested scalar is leading and `requiredPrefix` is absent.
Preserve existing declaration/FK identities and order; add missing derived paths
with the protocol descriptor, such as `key-reverse/inventory_item_id`, through
the existing legal Core name owner. Keep descriptor collisions fail-closed.

This grants selective all-row membership only. It adds no endpoint FK, uniqueness,
private membership document, adapter query repair, physical table, SQL index or
capacity increase. Bound the implementation to actual supported derived paths;
the protocol's broader `textEquality` coverage does not expand Core's currently
unsupported ordered lowering.

Pinned `IndexRegistry::index_keys/index_updates`,
`crates/indexing/src/index_registry.rs:172-244`, already maintains ordinary scalar
old/new keys. `IndexConfig`,
`crates/common/src/bootstrap_model/index/index_config.rs:39-53`, treats changed
fields as a different index specification. Reuse pending overlays, interval/EOF
observations, native acceptance and the five-table persistence unchanged. The
adaptation is native schema inference, not a different Source index algorithm.

## Identity and lifecycle

Composite-key definitions already hash the serialized lowered schema, including
index closure. Native and bundle metadata also bind exact indexes. Adding a
missing path changes the affected generated identity; it must not silently
reinterpret old installed metadata. Exact expected-proof authentication rejects
that mismatch before native execution. Preserve unchanged definitions' metadata;
do not globally bump their lowering version solely for this addition.

Prove fresh installation/cold reopening and old affected proof refusal. This
does not admit a populated Medusa successor, implicit reset or data conversion;
those require their named shared-lifecycle disposition.

## Proof

Preserve the pre-fix neutral plan/capacity witness, then prove selective complete
history with unrelated endpoints exceeding the capture bound. Cover existing
unconditional/FK coverage reuse, unchanged uniqueness and membership-only
semantics, empty and pending transitions, selected/unrelated changes, relevant
accepted-unsaved validation and cold authentication. Run PGlite and ordinary-role
PostgreSQL plus the complete genuine native consumers. Preserve the executing
native capture granularity and verdict rather than imposing Application event
conflicts. No native hosting, scale or performance result follows from this proof.
