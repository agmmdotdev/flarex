# SalesChannel Logical Storage Cutover

Status: implemented under the approved shared-storage completion goal. The Product–SalesChannel Link and its composed workflow moved in the [connected cutover](./20-product-sales-channel-link-workflow-cutover.md). The native compatibility runner moved in the [runner cutover](./21-sales-channel-native-runner-cutover.md); the Product–ShippingProfile router moved in its [connected cutover](./23-product-shipping-profile-link-workflow-cutover.md).

## Contract And Evidence

The pinned SalesChannel model owns an ID primary key, searchable name and nullable description, disabled default, nullable metadata, managed timestamps and soft-delete column. Its native module service owns create, update, delete, list, count and retrieve. The existing adapter already binds that service to the shared commerce command lifetime, but its physical profile installs a deployment-named table. The former physical binding test supplied the native defaults, metadata merge, event cardinality, read, rollback and two-module composition requirements. The Product–SalesChannel workflow has since moved to three logical participants.

The core logical row/index/constraint and atomic publication owners already execute Currency, Product, base Pricing and a selected Link. SalesChannel needs a checked logical definition and an event receipt for its own insert, patch and delete attempts; it does not need an adapter SQL writer or a second transaction owner. The first connected read showed that ID uses the shared primary-key path, while the pinned model's searchable name does not declare an equality index. The initial derived ordered name index was insufficient: a native-valid 2,047-character name failed at the shared 2,048-byte encoded-key ceiling. Its replacement is the shared nonunique exact-equality contract in [unrestricted text equality](./19-unrestricted-text-equality-index.md). Unbounded catalog reads remain limited by existing resource policy and are not a scale claim.

## Connected Slice And Break

Compile the one pinned SalesChannel DML model to a normalized relational definition with source provenance. Admit that source through the existing joint Application/Payload/Medusa composer, with one stable logical table identity and no generated module DDL. Run native create, update, delete and bounded list/count/retrieve through that selected source. Match each native created/updated/deleted message to the exact attempted row ID and operation before publication. Prove defaults, nullable/JSON values, scope isolation, rollback, replay and physical table-count invariance on PGlite and ordinary-role PostgreSQL.

The private standalone SalesChannel host/test selection changes from a physical profile and installation reference to the logical source and initialization receipt. Its native behavior and the two-module Product/SalesChannel atomic witness move to the logical suite; the displaced physical standalone binding fixture is removed. The Product–ShippingProfile router moved in its [connected cutover](./23-product-shipping-profile-link-workflow-cutover.md). No named durable environment is reset or converted. This slice does not activate SalesChannel product relations, arbitrary module methods, a public developer API, advanced populated-data evolution or a fallback engine.

The native `is_disabled` equality filter later gained a declared shared Boolean
access path under [indexed Boolean selection](./24-sales-channel-boolean-selection.md).
Sparse matches can be selected beyond the complete-set bound; large match sets
still stop at the explicit resource limit.

## Completion Gates

Verify native service outputs, event-to-row cardinality, committed indexed reads, rollback, replay, two-shop isolation and the cross-module atomic root on both database drivers. Run the source guard, typechecks, lint and both required read-only reviews. Commit one coherent slice; the Link/workflow cutover is now recorded separately, while structural migration retirement remains a gate.
