# Boolean partial index membership

## Status and scope

Status: bounded implementation in shared logical storage. This extends
existing shared logical index and unique
membership for the native [Customer selection prerequisite](../flarexdb-framework-integration/preflight/162-native-cart-customer-selection.md).
It adds no transaction owner, public query syntax or module-specific storage.

## Authority and semantic requirement

The [accepted database design](../../design-notes/flarex-db-accepted-design.md),
[shared storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
and [package boundaries](../16-package-boundaries.md) remain authoritative.
Frameworks declare native constraints; shared storage owns their enforcement.

Native Customer Address default-billing and default-shipping indexes are unique
on `customer_id` only when the respective Boolean is true and `deleted_at` is
NULL. The native DML index builder appends the active-row condition before both
the native ORM and Drizzle consume the declaration. Native PostgreSQL catalog
expressions confirm that conjunction. A plain active unique index would reject
valid nondefault Addresses; dropping the constraint would allow duplicate
defaults.

## Representation and ownership

The checked relational source adds `isNullAndBooleanEquals`, with separate
scoped nullable and Boolean column references and a strict Boolean literal.
Ordered and unique requirement compilation lower it to the existing physical
spec family as `fieldIsNullAndBooleanEquals`, with `nullField`, `booleanField`
and `value`. Both fields must be declared and distinct. Missing, null, numeric
and textual Boolean lookalikes never satisfy membership.

The existing protocol canonicalization and stored-source reconstruction own
identity. Existing ordered-entry, revision, unique-claim and publication owners
consume the same membership decision before encoding a key. No adapter performs
constraint SQL or independent enforcement.

Read metadata retains Boolean selector literals when they affect partial-index
eligibility. Point and page selection require both actual guards; a broader
complete anchor may serve a query without them. The compound index is never
advertised as an unconditional native scalar anchor. Cached true and false
selections, including misses, remain distinct. Historical unique selection
retains the complete predicate, independently of current claim ownership.

## Compatibility and cutover

Existing null-only, text-conjunction and unconditional spec bytes and identities
stay unchanged. Existing read metadata omits Boolean selector metadata when no
Boolean predicate exists. Application/Payload document unique declarations keep
their existing grammar; this does not expose a new developer declaration.

Convex's existing table-index API in
`npm-packages/convex/src/server/schema.ts` remains the developer model. This
native relational constraint is a framework compatibility requirement rather
than an addition to that public API.

The additive catalog migration extends the two existing JSON CHECK constraints
to admit the exact typed physical variant. Existing definitions and stored data
need no rewrite. Fresh installation and the actual predecessor-to-new CHECK
transition have separate validation. That control does not establish a general
populated-schema upgrade or installer-drain guarantee.

The displaced per-table physical layout route explicitly refuses the new
predicate. This logical-source capability does not admit physical-DDL support
or create another schema engine.

## Correctness gates

Validate neutral ordered/unique membership, atomic conflict rollback, false
duplicates, active true conflicts, soft-delete release, restoration conflicts,
stored revisions, historical unique-claim selection and cold reopening on
PGlite and ordinary-role PostgreSQL.
Retained protected-metadata cache and historical snapshot controls use the real
PostgreSQL installation owner; PGlite does not claim that issuance route.

Preserve existing native Pricing null/text conjunction and null-only profiles.
The complete genuine four-model Customer compiler closure must retain both
Address constraints before Customer workflow admission. Customer selection,
Cart composition and hosted activation remain separate gates.
