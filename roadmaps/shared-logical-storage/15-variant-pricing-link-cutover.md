# Variant–PriceSet Link Logical Storage Cutover

## Authority And Contract

This is the focused Link preflight under the accepted shared-storage completion
goal. The pinned `ProductVariantPriceSet` definition generates one rich stored
`product_variant_price_set` row with a composite pair identity, non-key `id`,
timestamps, soft deletion and active endpoint indexes. It declares no endpoint
foreign keys. Native Link create, cardinality and event behavior stay with the
promoted Medusa Link module; Flarex owns scoped rows, ordered indexes, unique
claims, bounded reads and settlement. A stronger endpoint-existence policy is a
separate explicit relationship decision, not an implied consequence of storing
the Link beside Product and Pricing.

The Link source requires the configured Product and base Pricing definition
sources at composition. That schema dependency does not require either endpoint
row to exist before a Link attach.

The selected native attach step now writes and queries that Link through a
logical source composed beside Product and base Pricing. It reads the new row
while the root is pending and publishes one attached message. A conflicting
bulk attach rolls back, active endpoint cardinality refuses a second target,
replay is stable, and colliding endpoint pairs remain isolated across two
shops sharing physical tables. An ordinary-role PostgreSQL race admits only one
of two concurrent attaches for the same variant. These are bounded functional proofs, not a
claim about every Link lifecycle operation or load capacity.

## Connected Slice

Compile the pinned generated Link metadata into one authenticated relational
source and select it for native Variant–PriceSet Link attach and ID/endpoint
reads. Authenticate each successful attach event against the attempted inserted
Link row, including its native non-key ID. Refuse unadmitted
lifecycle commands and event/mutation shapes. Retain the Link row as authority;
do not dual-write a generic edge, use adapter SQL or grant target mutation.
Prove native attach, generated IDs, active endpoint cardinality,
pending and committed reads, event publication, replay, rollback and scope
isolation on PGlite and ordinary-role PostgreSQL. Build and query the actual
shared endpoint indexes; merely admitting the definition is insufficient.

This breaks the private Link storage selection and fixture constructor for
this selected consumer. The native workflow/public DTO and event names do not
change. The existing physical Product–Variant–Pricing workflow and generalized
Link fixture remain as named unmigrated consumers, with removal when those
connected workflows and Link lifecycle contracts move. This slice does not
drop their physical tables or invent an existing-data conversion.

## Next Gates

Move the native Product–Variant–Pricing workflow's three participants to
logical Product, base Pricing and this Link source in one atomic root. Prove
multi-step pending graph reads, cardinality, missing endpoints, rollback,
replay, two-shop isolation and uncertain outcome against the physical baseline.
Then migrate explicit-ID attach/replacement, Link dismiss/restore and other
existing Link consumers, including restore/cardinality races; remove
physical profiles, installation evidence and DDL only after their named
consumers and data obligations are resolved. Advanced populated-data evolution
remains under the deferred migration contract.
