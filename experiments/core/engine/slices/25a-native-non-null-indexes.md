# Ordinary Core backing for native non-null declarations

Status: **Schema lowering and named page admission implemented. Bounded paired
acceptance complete.**

Before this replacement, the complete [Order Change source](./25-native-order-change-workflows.md)
failed at `lowerCoreNativeRelationalSchema` with `unsupportedCapability`. The
executing preserve-mode producer emits 23 models and 34 nonunique B-tree
declarations in the affected shapes. Each tests the sole declared key for
non-null membership. The Medusa parser and relational protocol already retained
both shapes. The shared Core lowerer now admits them.

Pinned Convex `value/src/sorting.rs`, `common/src/query.rs::IndexRange::compile`
and `database/src/query/index_range.rs` place missing and null below non-null
values, compile contiguous equality plus range constraints, and record the
consumed interval or its actual EOF. Use ordinary full-row index backing on
`[field]` or `[nullColumn, field]`, with existing index maintenance and bounds.
The exact `gt(null)` lower bound and optional fixed null equality select the
eligible interval. Retain the original Source predicate and native descriptor
and attach the non-null requirement to its authenticated native binding.
See the [divergence](../divergences/native-non-null-index-backing.md).

Only lower the demonstrated nonunique single ordered key shapes. Preserve the
existing equality predicate, uniqueness and FK contracts. The real Order source
already has implicit active-row indexes with fields `[deleted_at]`, and Core
admits one ordinary backing per ordered field list. Lower all existing key,
equality, FK and reverse paths first. Attach a guarded alias to an exact existing
backing, preserving its first binding and authority. Allocate a backing only for
a novel field list. A guarded declaration supplies neither an unconditional
historical FK/reverse path nor generic relational page authority. Refuse explicit
named pages on backings owned only by these new guarded bindings. The selected
workflows use complete bounded ID and relationship reads with their existing
residual predicates. Their reads can use ordinary covering indexes according to
the actual query interval. No new page selector is required.

Prove the original schema refusal, real full Order capture, stable prior binding
identities, native predicate metadata, supported and refused declaration shapes,
separate unconditional historical membership, and interval completeness for null,
non-null and soft-deleted rows. Use neutral paired PGlite and ordinary-role
PostgreSQL witnesses for actual pending and durable ordinary-index maintenance
and fail-closed named access. Rerun earlier equality and range owner cases.

The shared lowerer authenticates index bindings and the relational query owner
chooses eligible page backings. The existing transaction owner applies the first
binding's policy for explicit named access. It checks the non-null marker before
constructing the interval and retains the existing equality-prefix checks.
