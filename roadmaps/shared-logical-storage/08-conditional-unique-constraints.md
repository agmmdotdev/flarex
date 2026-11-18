# Conditional Shared Unique Constraints

Status: implemented in shared unique storage, build and settlement owners.

## Connected Outcome

Extend the existing authenticated unique physical specification with an optional
`predicate: { kind: "fieldIsNull", field }` and `nullsDistinct: true`. Absence of
these options preserves the deliberate Application contract: every row participates,
explicit null is a claim, and `sparse` skips missing components only. A predicate
matches actual null, never a missing path. With nulls-distinct enabled, any actual
null key component excludes the entire tuple. These are independent policies.

The pinned Medusa Product model declares unique handle where deleted_at IS NULL.
The shared owner must enforce that predicate before key encoding: excluded rows
must not fail an irrelevant unique-key size limit. Framework normalization remains
responsible for materializing native defaults such as deleted_at=null.

Reuse the unique definition catalog, closed-set build/readiness, row materializer,
claim store and final settlement. One document-to-claim projection determines
backfill, before/after writes, and stored-state validation. Exclusion carries no
fabricated key. Ordinary queries cannot treat a partial constraint as proof that
excluded matching rows do not exist.

## Replacement And Data Boundary

The private document-projection API returns a discriminated claim or exclusion;
its build, materialization, CMS and retained measurement consumers are migrated.
New predicate
or null semantics change canonical definition identity and require normal build
and activation gates. No reinterpretation of existing physical definitions or
silent removal of durable claims is authorized. No per-framework constraint
engine, adapter SQL bypass or duplicate settlement owner is added.

The platform migration updates the catalog's physical-spec JSON check to accept
the new closed metadata shape. It preserves existing definitions, bytes and claims;
it is not framework logical evolution or a populated-data conversion.

Arbitrary SQL predicates, localization, collation, public schema APIs, populated
framework upgrades and complete Medusa storage execution remain outside this
slice. These primitives prepare the later native commerce cutover.

CMS does not use a conditional unique definition as an unrestricted lookup path,
nor a null-distinct definition for a null key. Such requests use an applicable
ordinary index or the existing bounded scan. Predicate-aware selective query
planning and native Medusa schema translation remain consumer cutover work.

## Decisive Gates

Prove canonical metadata authentication, exact null/missing behavior and excluded
oversized keys. Exercise existing-row backfill and validation, active handle A,
soft-delete A, active B reusing its handle, and failed restoration of A with no
partial row/claim/publication state. Include predicate/key transitions, competing
active claims, scope isolation, rollback and replay through shared settlement.
Use PGlite and ordinary-role PostgreSQL, affected types/lint and both reviewers.
Remove obsolete projection assumptions in the same slice.
