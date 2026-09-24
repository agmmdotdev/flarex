# Product–SalesChannel Link And Workflow Cutover

Status: implemented under the approved shared-storage completion goal. The native SalesChannel compatibility runner and Product–ShippingProfile router have moved to logical storage under their connected cutovers.

## Before Cutover And Owner

Product and SalesChannel already use selected logical sources. Their stored native Link and the composed create workflow still select a deployment-named, fifteen-table physical schema. The pinned native Link owns a rich row, a unique active endpoint pair, lifecycle timestamps, attach/detach messages, and a two-endpoint joiner. The Link definition declares no endpoint foreign keys. Flarex owns scoped logical storage, uniqueness, transaction settlement, receipts, and publication. The existing physical test suite is the behavioral witness, not an obligation to retain the generated table layout.

The selected Variant–PriceSet Link proves that native Link methods can use the generic logical row/index/constraint machinery. Its logical event receipt initially assumed `variant_id` and `price_set_id` and one write call per root. The old physical Product–SalesChannel witness attaches the same pair twice in one root and authenticates both event IDs. The shared atomic owner must expose each call's attempt and lifecycle span so the logical receipt can attribute both writes. An unchanged restore also needs a bounded operation-time row snapshot: the final pending row may be deleted or replaced by a later call. The existing native Product–SalesChannel workflow proves three-participant atomic creation, pending graph reads, event attribution, replay, rollback, and recovery.

## Connected Replacement

Compile the checked Product–SalesChannel Link into one scoped relational logical source. Compose it only when both endpoint modules are selected. Keep its native Link service/router and workflow steps, binding all three participants to their selected logical sources under one atomic owner. Require exact row/lifecycle-to-event receipts per native call based on the admitted endpoint columns. Test active-pair uniqueness, two attaches in one root with both event IDs, reattach ID replacement, soft delete/restore, bounded pending and committed reads, rollback and replay, two-shop isolation, and physical table-count invariance on PGlite and ordinary-role PostgreSQL. Retain no endpoint foreign key or cross-source hydration claim that the pinned definition does not provide.

This breaks the private physical Link profile and physical workflow fixture. Migrate their behavioral witnesses to logical hosts and delete the displaced generated-schema helpers, physical fixture, exports, and stale documentation. The Product–ShippingProfile router has moved under its [own cutover](./23-product-shipping-profile-link-workflow-cutover.md), which retires the remaining generated Link table and `prepareProductShippingProfileSchema`. The native SalesChannel compatibility runner has moved under its [own cutover](./21-sales-channel-native-runner-cutover.md). No durable named environment is reset or converted in this slice. This work does not activate arbitrary Medusa modules, advanced populated-data evolution, public developer APIs, or hosted deployment.

## Completion Gate

Run focused native Link and workflow tests on both drivers, the source-provenance guard, affected typechecks and lint, and both required read-only reviews. Record remaining physical consumers in the completion plan and commit one coherent green slice.
