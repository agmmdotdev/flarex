# Native indexes with an off-key non-null predicate

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Medusa's complete Cart source declares a nonunique CreditLine B-tree on
`(reference, reference_id)` with `deleted_at IS NOT NULL`. Convex's ordinary
index registry derives keys from declared fields and has no native relational
partial-index declaration. Retaining only the original tuple and filtering
can exceed the logical examined-row limit when many active CreditLines share
it.

For a nonunique B-tree with ordered scalar keys and a distinct
ordered scalar `isNotNull` column, lower to an ordinary logical index with
the predicate column appended. Preserve the authenticated source descriptor
and required non-null condition. For CreditLine, equality on both reference
fields followed by `deleted_at > null` selects the historical interval through
the existing Convex range owner. With an incomplete equality prefix, retain
the existing bounded residual behavior. The Cart workflow reads active
CreditLines through their independent parent path. This lowering adds no new
relational filter operator or physical schema change.

The complete Promotion source declares the same form on
ApplicationMethod's single `currency_code` key with `deleted_at IS NOT NULL`.
Lower it to `(currency_code, deleted_at)` using the same equality prefix
and non-null suffix. The source was refused while admission required at
least two key columns. The single-key extension keeps the existing index
range, lifecycle and foreign-key access contracts.

The logical examined-row bound applies after the ordinary snapshot reader
returns its exact interval. Like pinned Convex, the PostgreSQL reader can
hydrate and buffer a whole physical group when long keys share a 2,500-byte
prefix before checking the full bounds. The neutral witness measures the
logical scan. Physical long-prefix behavior remains with the existing reader.

Keep the existing guarded-page refusal, independent unconditional foreign-key
and reverse access, and the existing single-key and compound conditional-null
contracts. Unique indexes, predicates on a field already in a multi-column key,
and other unsupported forms remain outside this lowering. The neutral proof
showed that interval entry invalidates an exact read, that active siblings stay
outside its dependency, and that parent reverse access sees historical rows.

Reassess the backing only if the authenticated source predicate changes or
the common logical index owner gains an equivalent bounded access path.
