# Internal Product and Category compatibility preflight

Status: preflight complete; Category admitted in Record 44, internal Product pending.
Baseline: `f7aa56a2` (Record 42). Pinned Medusa:
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Decision

Implement the complete **31-declaration internal Category file first**, then
preflight the concrete implementation of the **23-declaration internal Product
file** as a separate slice. Category reuses the already promoted specialized
service. Product adds different DAL, query and static metadata requirements.
Do not combine both into an implicit framework or core migration.

This record authorizes no runtime admission by itself. Its companion
[`product-internal-suite-preflight.json`](./product-internal-suite-preflight.json)
records all 54 source declarations, exact hashes, source lines, methods and title
multiplicities. They are not newly executed tests. The current gate remains
151 original passes plus one upstream skip per driver from Record 42.

## Verified source inventory

Both files are under the pinned Product `integration-tests/__tests__/` directory.

| File | Declarations | Breakdown |
| --- | ---: | --- |
| `product-category.spec.ts` | 31 | list 10; retrieve 5; listAndCount 5; create 2; update 6; delete 3 |
| `product.spec.ts` | 23 | static linkable 1; retrieve 3; create 1; update 5; list 11; softDelete 1; restore 1 |

Both hashes match the historical remaining-suite inventory; all listed source
lines still point to declarations, and independent declaration counts match.
The Category file does **not** exercise Category soft deletion or restore.
Do not add those operations merely because the Product file exercises lifecycle.

The Category list tests at lines 110 and 275 have the same full title. The current
`productCoverage` reporter requires each name exactly once and cannot register
that unchanged file correctly. Change the reporter to compare expected and actual
name multiplicities (or stable source occurrences), preserving duplicate tests.
Add negative reporter checks for a missing occurrence, excess occurrence and
unexpected test. Do not rename, skip or weaken originals. Existing public names
must retain their exact one-occurrence gate.

## Internal Category: concrete gaps and retained owners

1. **Private entry boundary.** The original reads
   `moduleService.productCategoryService_` and calls `list`, `listAndCount`,
   `retrieve`, `create`, `update` and `delete` directly. The current runner refuses
   that property. Add an explicit test-only facade backed by named, bounded
   adapter commands that call the real request-owned Category service. Do not
   return a live service, context, repository or manager outside its request.
   Do not implement the facade by redirecting calls to public module methods.
2. **Reads.** Source lines 96 and 775 require arrays of parent IDs; the current
   Category external and repository decoders admit only a scalar parent or null.
   Bound array membership using existing scoped query capabilities. Line 643
   requests `parent_category`; the current inverse projection admits only
   `products`. Let the source Category service hydrate parent/child relations;
   the repository must validate those tree hints without building a second tree
   loader. Existing scalar/FK projection and full scoped catalog reads remain.
3. **Representation and errors.** Internal service methods return entities/arrays
   directly, without the public module's final `serialize`. Capture their actual
   result at the adapter boundary with the existing Category representation codec.
   Preserve array/count/delete return shapes, null, absence and own undefined.
   The omitted-ID case at line 618 must reach the original service's exact
   `"productCategoryId" must be defined` failure; an omitted optional wire member
   can represent that call without weakening the core JSON contract. Copy input
   filters because the source service removes tree flags from its working copy.
4. **Mutations and events: first implementation checkpoint.** Direct calls bypass
   public `createProductCategories` handle normalization, its manual created-event
   builder and `EmitEvents`. The current tree DAL and local event policy were
   admitted through that public context. Establish the pinned direct-call
   subscriber/aggregator behavior before admitting writes. Define any required
   internal command policy explicitly with the adapter owner; preserve the actual
   internal event behavior, all authenticated row facts and outer commit ownership.
   Never fabricate public events, silence the existing public policy, or infer a
   publication contract from tests that make no event assertions. If a shared-core
   owner correction is required, document the reproducer and stop for its separate
   approval under AGENTS.md.
5. **Tree changes.** Reuse source rank, move, descendant-path and leaf-delete
   algorithms. The electronics fixture is already promoted byte-identically.
   The deep move at line 1154, simultaneous ancestors/descendants and multiple roots
   require new execution evidence. Keep cycles, forged paths, reserved/dotted IDs,
   cross-scope references and all resource limits fail-closed. Internal update
   arrays must be validated as one complete request before any member can commit.

The direct event boundary is the first proof gate, not a reason to invent a
parallel transaction path. The exact choice of source-compatible internal event
policy must be written into the implementation receipt before full admission.

## Internal Product: separate next slice

- There is no standalone `ProductService` implementation/export in the pinned
  services index. That old test import is used in type positions; the actual
  `productService_` is generated by `MedusaInternalService(Product)` and already
  injected by the current composition. Do not invent a replacement Product class
  or promote an ORM service to satisfy that type spelling.
- Internal `create` takes normalized model data, while public creation normalizes
  inputs first. Check the pinned required/default/handle behavior against
  `buildProductOnlyData`; it already supplies handle/default fields through the
  promoted pure fixture export. Keep that facade and leave ORM fixture writers
  in the source island. Preserve raw internal returns and exact failures.
- Internal `update` builds selector/entity-update pairs, including `$or` reads and
  scalar/array return differences. The root repository currently refuses `update`
  and its Product query decoder does not admit those `$or` selectors. Adapt the
  actual generic internal service contract; public `updateProducts` uses a distinct
  portable `upsertWithReplace` path. Missing-ID rollback must stay atomic.
- The free-text case uses `q`. The current options decoder rejects its
  `freeTextSearch_*` filter. Pinned Drizzle derives searchable columns from DML and
  uses `LIKE` with `%value%`; establish wildcard, case and driver semantics before
  adding a bounded adapter query capability. Do not import its SQLite manager or
  casually substitute substring matching/ILIKE. A needed core predicate change
  gets a separate owned preflight.
- Category relation field selection and retained root/related primary keys must
  match the original assertions. The current Product decoder admits nested fields
  only for Collection/Type, and `findProducts` strips unselected root IDs; the
  internal Product file also expects root/FK/related IDs for public Collection
  projections. Preserve existing public projection cases while defining this
  profile; avoid a global projection change that contradicts current coverage.
- Reuse managed Product softDelete/restore, scoped deleted-row reads and complete
  facts. Preserve the internal restore tuple, and explicitly admit internal command
  identities in any applicable lifecycle/event policy. This does not admit
  Category lifecycle or a new settlement owner.
- `Module(...).linkable` is one **static metadata** case, not Module Link storage,
  resolution, attach/dismiss or workflow execution. Reuse checked model/linkable
  metadata. The existing Module helper imports the Node joiner wrapper; its pure
  builder is already separated. Keep Node/source-island imports out of portable
  runtime closure and do not hard-code the expected nine-entity object.

## Implementation sequence and retirement gates

1. Admit the private internal Category call/representation boundary and establish
   its source-backed event policy with focused rollback/fact/event proofs.
2. Admit bounded parent arrays and tree relation hints in the existing Category
   decoder/repository, with no new core capability unless separately approved.
3. Register the complete unchanged 31-declaration file, retain fixture bytes,
   authenticate promotion/aliases and enforce exact title multiplicities.
4. Prove all 31 originals plus boundary guards on PGlite and ordinary-role
   PostgreSQL. The combined target is **182 passes plus the existing one skip**,
   conditional on every declaration executing; until then keep 151 as current.
5. Run existing Categories/public Product and local transaction regressions,
   Currency checks, strict authored-code and source-guard compilation, promotion,
   bundle and lint gates. Obtain both required reviewers before the code commit;
   stop the owned PostgreSQL fixture afterward.
6. Update this record with evidence, then take the separate 23-declaration Product
   slice. Only after both files pass would the original gate reach 205 plus one
   skip; that is a target, not current coverage.

Retain the current public command facade and adapter authority checks. Extend the
existing Category service composition and decoders. Replace only the reporter's
unique-name assumption and the runner's blanket refusal for the specifically
admitted internal property. Do not add a raw-service escape hatch, duplicate tree
algorithms, permanent comparison fallback, new resource profile or exported core
primitive. Leave the historical inventory immutable and update the active case
inventory only when each original is actually registered and proven.

## Validation of this preflight

Read-only source inspection and hash/declaration/line verification cover all 54
entries. The current promotion verifier passed 354 files across ten packages.
No runtime code, original tests, active case inventory or transaction owner was
changed; no new database tests were executed or claimed. Source baseline and
Record 42 receipts remain the authority for the existing 151-case gate.

Continuation: [Record 44](./44-medusa-internal-product-categories.md) implements
the approved internal Category slice. All 31 originals and three boundary checks
pass on both drivers; its complete combined gate is 182 originals plus one
retained upstream skip per driver. Internal Product's 23 declarations remain separate.
