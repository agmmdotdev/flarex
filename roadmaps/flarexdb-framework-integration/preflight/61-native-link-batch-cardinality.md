# Native Link Batch Cardinality: Preflight

Status: approved and implemented. Preflight 59 A and the
preflight 60 shared-owner correction are implemented. ShippingProfile activation
and singular Link storage support remain unapproved.

## Outcome And Why Now

Correct native `Link.create` so one input batch cannot select different partners
for an endpoint whose relationship is singular. This closes the executable
router defect found by preflight 59 before adding ProductShippingProfile.
The correction belongs to Medusa's promoted Link router, not Flarex core or a
ShippingProfile-specific adapter branch.

This slice does not install tables, promote Fulfillment, activate another
workflow, or establish database-enforced singular Link cardinality. The nearest
proof is rejection before delegation through the actual native router, with
existing stored ProductSalesChannel behavior retained.

## Evidence And Authority

- `design-notes/flarex-db-accepted-design.md` keeps Medusa Link/service semantics
  with Medusa and scoped storage/settlement with Flarex.
- `roadmaps/16-package-boundaries.md`, adoption roadmap 06 and preflight 59
  require native-owner correction, explicit source promotion and bounded grants.
- `third_party/medusa/SOURCE.json` pins fork
  `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline 2.13.4. Its comparison
  snapshot remains untouched; executable code is in the promoted packages.
- `packages/medusa-modules-sdk/src/link.ts` groups incoming tuples by resolved
  Link service, checks stored rows using native relationship metadata, then
  delegates creates. The approved correction now compares incoming partners
  within each service batch before any create delegation.
- `packages/medusa-adapter/test/native-link-cardinality.test.ts` executes that
  router against a recording service. Its former expected-failing witness now
  asserts native refusal of `(p, a)` and `(p, b)` for ProductShippingProfile-shaped
  metadata, with zero creates. This is not stored
  ShippingProfile conformance.
- The native ProductShippingProfile definition sets Product `hasMany: true`
  and omits ShippingProfile `hasMany`. Its exposed Product profile is singular;
  a profile may serve multiple Products.

## Implemented Contract

Use the resolved service's existing ordered relationship metadata and the
native endpoint tuples. Before any service create, reject a batch containing
different partners for a constrained endpoint. Missing `hasMany` remains false,
as in the current native existing-row checks.

| First relationship | Second relationship | Allowed incoming pairs |
| --- | --- | --- |
| `hasMany: true` | `hasMany: true` | Many-to-many; no new restriction |
| `hasMany: true` | false or absent | Each first endpoint selects one second endpoint |
| false or absent | `hasMany: true` | Each second endpoint selects one first endpoint |
| false or absent | false or absent | Each endpoint selects one partner |

The native router uses operation-local partner maps per resolved service, with
JSON-encoded native string/string-array primary keys to preserve structural
identity and component boundaries. It neither concatenates opaque IDs with an
ambiguous delimiter nor compares fresh arrays by identity. Work is linear in
incoming key material, rather than a quadratic pairwise scan.
No module-name dispatcher, generic CRUD factory,
exported validation framework, registry or persistent state is needed.

Preserve these native boundaries:

- Throw native `MedusaError.Types.INVALID_DATA` with the existing multiple-links
  message style. Do not add an adapter error translation to conceal the defect.
- Reject before any service create, including when an earlier service has a
  valid batch and a later service has a conflict. The new batch check may fail
  before stored-row reads; existing valid-batch query and create order stays.
- Retain existing stored-row queries, `take: 1`, shared context, tuple order,
  optional `data`, grouping and flattened results.
- Delegate exact duplicate tuples unchanged. Do not deduplicate or select a
  winner. Delegation does not promise storage success or idempotency. In
  particular, existing one-to-one stored-row checks also reject a stored exact
  pair; redesigning that behavior is outside this correction.
- Preserve current module/key routing. Do not implicitly support reversed
  module insertion order or broaden LinkDefinition input admission.

## Database Boundary Still Open

`packages/medusa-link-modules/src/utils/generate-entity.ts` currently generates
composite endpoint primary keys and nonunique active-row endpoint indexes. It
does not derive endpoint-only uniqueness from `hasMany`. The current
ProductSalesChannel adapter lowers an explicitly checked many-to-many schema;
it is not a general singular-Link schema adapter.

The router fix cannot enforce cardinality for direct service calls, competing
external transactions, or restore/deleted-row conflicts. Do not claim those
invariants from router tests or same-scope serialization. Before preflight 59 B
activation, resolve the native structural metadata/constraint contract and its
adapter lowering, with active/deleted/restore and ordinary-role PostgreSQL
concurrency evidence. Any required generator/schema change needs that explicit
approval. An adapter-only unique index is not a substitute for deciding the
native contract.

Native `LinkModuleService.buildData` also spreads extra fields after endpoint
keys. Arbitrary native `data` can therefore replace endpoints downstream of the
router's checks. The current ProductSalesChannel input decoder admits only
`data.id`; keep future extra-field admission explicit and prevent endpoint
replacement before claiming stored singular-Link cardinality. This slice does
not broaden input admission or rewrite native `data` semantics.

Rejected alternatives: ShippingProfile-specific checks would repeat the fix for
future modules; adapter SQL or a second transaction would cross authority;
silently deduplicating or serializing a contradictory batch changes business
input. Combining the storage correction here would introduce a separate schema
and lifecycle decision before its semantics have been approved.

## Ownership, Compatibility And Cleanup

- **Extend:** native `Link.create` batch validation only; preserve its native
  Promise/service boundary and existing stored-row behavior.
- **Retain:** original native router tests, checked-in comparison sources,
  existing many-to-many service/schema behavior and connected workflow proofs.
- **Replace:** contradictory-delegation characterization is replaced with
  ordinary rejection and zero-create assertions; no expected-failing cardinality
  witness remains. The generator's missing-uniqueness characterization is separate.
- **Extend:** focused authored native tests and source-promotion receipts in
  `medusa-currency-promotion.json`, preserving upstream source hashes and the
  explicit `linkFork` adaptation classification.
- **Defer:** generator/index changes, singular-Link storage lowering,
  Fulfillment construction, ShippingProfile activation, restore semantics and
  any public contract or runtime expansion.

No new migration, identity/version, compatibility wrapper or retained legacy
path is needed for this pre-write correction. Remove temporary diagnostics;
retain no second cardinality algorithm in the adapter.

## Validation And Completion

Exercise all four cardinalities through actual `Link.create`, using neutral
renamed endpoints as well as the ShippingProfile-shaped witness. Cover both
conflict directions, exact duplicates, repeated requests, compound primary
tuples and delimiter-like IDs, separate services, empty input, unchanged
data/context/result ordering and existing stored-conflict refusal. A mixed
service batch with a later conflict must perform zero creates in every service.
These are router proofs, not claims of compound-key or singular stored support.

Retain and run original native router tests and focused inequality tests.
Run affected typechecks, promotion/source guards, `pnpm lint:core` and
`pnpm lint:diff`; obtain both required read-only reviews on the final code scope.
Run existing stored ProductSalesChannel and connected workflow regressions in
PGlite and ordinary-role PostgreSQL, with separate results and unchanged
deadlines. Neither lane establishes ShippingProfile or production readiness.
Run staged diff lint before the scoped implementation commit.

Completion means the native batch defect is corrected, regressions pass,
provenance and roadmaps agree, and one coherent implementation commit exists.
The next decision remains singular-Link storage semantics and the bounded
ShippingProfile foundation, not automatic B activation.
[Preflight 63](./63-native-singular-link-storage.md) now owns the proposed storage
and endpoint-protection correction; its implementation is not yet approved.
