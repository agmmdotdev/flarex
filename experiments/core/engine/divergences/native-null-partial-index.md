# Native null-predicate index lowering

Status: **Bounded relational equality-prefix lowering, paired owner/native
PriceList index proof and complete selected Native18 consumer proof implemented
and reviewed. Arbitrary SQL partial-index predicates remain unsupported.**

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` ordinary database indexes do
not carry the selected Medusa SQL partial-index declaration. Currency's genuine
DML source includes its active-row index. Omitting that source declaration or
copying the old SQL installation machinery is not the destination.

For the narrowly selected btree predicate `softDeleteColumn IS NULL`, an ordinary
Source index can represent the required access through fields
`[softDeleteColumn, ...declaredColumnsWithoutThatColumn]`. Its entries include
all rows. The native partial-index access supplies the mandatory equality-null
prefix, preserving the remaining declared order and excluding deleted rows.
This is a physical index superset with an authenticated native access condition;
the unqualified ordinary Source index is not itself a partial index.

Derive the index, its stable legal descriptor, required prefix and semantic
lowering version from the complete authenticated source. Preserve original
native key/index identities in its binding. Reject unsupported predicates,
capabilities and column types before installation. Do not claim general SQL
partial-index or conditional uniqueness support. Currency's ordinary code page
uses the unconditional primary-code index and must not acquire a narrower
active-only observation merely because another index is available.

Prove source/lowering authentication, equality-null selection, retained code
uniqueness through soft deletion and unchanged query observation/resource
contracts. Keep all index data in the translated five-table owner; no native
physical index catalog or SQL enforcement path is added.

## PriceList null-and-text continuation

The [Native18 consumer](../slices/18-native-product-multi-source-workflows.md)
installs the complete pinned Pricing producer. Its genuine `price_list` index
`PriceList_id_status_starts_at_ends_at_0` declares
`[id, status, starts_at, ends_at]` with `deleted_at IS NULL AND status = 'active'`.
The protocol, Medusa producer and shared relational lowering preserve
`isNullAndTextEquals`. The complete Pricing declaration remains installed;
omitting it or replacing the complete source would hide required behavior.

Extend the existing authenticated bounded equality terms with a text literal,
preserving the old single-null, all-null and null-plus-boolean shapes. Lower this
predicate to the ordinary fields `[deleted_at, status, id, starts_at, ends_at]`
with the two mandatory native equalities. Deduplicate the fixed `status` field
while retaining the remaining declared order. Validate the literal against its
declared column and include it in the existing authenticated policy identity.

This reuses Convex's ordinary field index, full old/new document key maintenance,
pending overlay, read dependencies and acceptance owner. The backing index keeps
draft and soft-deleted rows as well as active rows. Complete native find may use
that full superset without silently injecting the partial predicate; explicit
native partial-index/page access must supply both required equalities. An index
prefix does not become a nullable business key; preserve the separate
[conditional uniqueness contract](./native-conditional-uniqueness.md).

Because the bounded eligibility representation is shared, its text conjunction
also requires neutral conditional-unique proof: null business-key participation,
pending entry/exit, concurrent claims and accepted predecessor failure. This is
a shared primitive contract, not a unique PriceList index or broader Medusa
workflow activation.

Prove authenticated source lowering, wrong literal/column refusal, missing and
wrong explicit prefixes, complete broader finds, pending and committed status or
deletion transitions, and preservation of old eligible shapes on both database
lanes. Then rerun the genuine complete multi-source consumers. No general
predicate parser, `isNotNull` extension, physical partial index, adapter checker,
new storage family or numeric-index project is part of this continuation.
