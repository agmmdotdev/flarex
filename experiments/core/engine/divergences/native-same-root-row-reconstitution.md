# Native same-root row reconstitution

Status: **Required native difference translated with neutral, actual-host and
selected Store acceptance and review. Wider native and hosted gates remain open.**

Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.
The [Store slice](../slices/23-native-store-workflows.md) owns scope and gates;
the [accepted native contract](../../../../roadmaps/shared-logical-storage/63-same-root-row-reconstitution.md)
owns the existing behavior being translated.

Convex ordinary writes retain the first original and prohibit reusing an existing
internal identity, including tombstones. Keep ordinary creation unchanged. Native
Medusa relation clearing additionally retains complete deleted child DTOs for an
inverse inside the same accepting root, preserving identity and creation time
while the selected native policy advances or preserves managed update time.

Expose this operation only through explicitly admitted native invocation policy,
authenticated in preparation and recovery. The transaction owner proves exact
complete active-row equality against its latest same-root physical deletion,
with the same source/table/key and no live or ambiguous destination. Reuse pending
deletion contents, mutation activity, first originals, normal row normalization,
indexes, constraints, native budgets and batch rollback. Final settlement still
coalesces the original to the final pending row once.

This is distinct from [recorded-row restoration](./native-recorded-row-restoration.md):
that operation can prove committed retained history and preserves recorded native
timestamps. Same-root reconstitution cannot use historical proof, create a fresh
identity or fall back to ordinary insertion. No new physical storage or proof log
is introduced. Forged/stale/cross-source bodies, earlier-root deletion, live-key
reuse and omitted or changed policies refuse through the existing failure owner.

Neutral two-driver owner and actual-host identity/recovery proof, plus genuine
Store clear/inverse behavior, are required before acceptance. General native
restoration, Application OCC, hosting and other goal gates remain separate.
