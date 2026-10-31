# Native null-predicate index lowering

Status: **Selected relational lowering implemented; general partial indexes and
conditional uniqueness remain unsupported.**

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
