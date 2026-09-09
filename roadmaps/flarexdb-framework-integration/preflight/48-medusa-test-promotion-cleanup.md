# Currency and Product test promotion cleanup

Status: implemented and validated (2026-09-09).
The user explicitly requested every promoted test and fixture be inspected and
cleaned up after completing the original-case compatibility baseline.

## Scope and evidence

The implementation baseline is `00d3ffdf`, which completed all 205 active
Product cases plus one upstream skip on both PGlite and ordinary-role PostgreSQL.
Record 47's independent shared-adapter preflight was committed as `dba86ff4`
during this cleanup and is preserved. This slice changes test sources, runner
types, compiler configuration and promotion tooling; production adapter and
shared transaction/publication behavior are unchanged.

The ten Product test files previously ran through Vitest aliases while their
wrapper files were excluded from the adapter compiler. Enabling full strict
test compilation exposed 532 diagnostics: missing imports, DML definitions used
as instance types, an absent internal service type, nullable hook fixtures,
unchecked indexes and unused fixture results. Currency still depended on a
Jest timeout shim and ambient test declarations. Runtime success alone did not
prove that these files were usable in the editor or covered by the compiler.

## Retain, change and remove

- Retain the exact pinned originals under `third_party/medusa/upstream`, with
  their source hashes, all scenario bodies, case names, assertions and skips.
- Maintain all thirteen runnable test copies as `testPort` entries. Import
  Vitest APIs explicitly; move the exact Currency timeout into the existing
  100000 ms configuration; resolve Currency static tests through the exact
  published exports. Runtime aliases still select the private test runner.
- Correct test types using actual Product DTOs and internal-service contracts.
  The private runner admits only its implemented methods and source-proven
  fixture input extensions. Erased non-null assertions record existing fixture
  and index invariants; runtime tests still prove those invariants. Expected
  error-message assertions retain their original evaluation.
- Retain deliberately unused fixture calls and bindings using local `void`
  markers. No fixture creation, assertion or case is removed to satisfy typing.
- Compile all promoted specs and all six Product fixtures with strict null
  checks, checked indexing and exact optional-property checks. Add package-local
  test projects for editor discovery and include Product wrappers in the adapter
  project. Package build/typecheck runs four projects, including the existing
  composite fixture project under its original compiler policy.
- Remove `test/support/setup.ts` and `test/legacy-test-globals.d.ts`. Disable
  implicit runtime test globals in the common and Product upstream configurations.
- Give the authored Product installation hook 120000 ms so its existing
  90000 ms migration cancellation deadline can finish cleanup. The default
  30000 ms hook deadline interrupted valid setup during full-suite validation.
  The owner deadline and all assertions remain unchanged; other hooks retain
  their existing configuration.
- Retain the existing selected Product fixture export facade and all production
  module exports. There are no new dependencies or source-island runtime imports.

## Complete file inventory

Paths below are relative to the named package. Every row is included in a strict
test compiler project; unchanged fixtures were inspected and need no edits.

| Package and test file | Active cases | Disposition |
| --- | ---: | --- |
| Currency `integration-tests/__tests__/currency-module-service.spec.ts` | 13 | Vitest/type port |
| Currency `src/__tests__/static-manifest.spec.ts` | 1 | Vitest/type port; exact published imports |
| Currency `src/services/__tests__/noop.ts` | 1 | Explicit Vitest imports |
| Product `integration-tests/__tests__/product-module-service/events.spec.ts` | 22 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/products.spec.ts` | 34 | Vitest/type port; one original performance skip retained |
| Product `integration-tests/__tests__/product-module-service/product-types.spec.ts` | 13 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/product-tags.spec.ts` | 15 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/product-collections.spec.ts` | 18 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/product-options.spec.ts` | 13 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/product-variants.spec.ts` | 15 | Vitest/type port |
| Product `integration-tests/__tests__/product-module-service/product-categories.spec.ts` | 21 | Vitest/type port |
| Product `integration-tests/__tests__/product-category.spec.ts` | 31 | Vitest/type port |
| Product `integration-tests/__tests__/product.spec.ts` | 23 | Vitest/type port |

All six Product fixture files are under `integration-tests/__fixtures__/`:

| Fixture | Disposition |
| --- | --- |
| `product/data/create-product.ts` | Type-only fixture port; remove DML instance cast and type existing indexes |
| `product/data/products.ts` | Type-only fixture port; type existing category indexes |
| `product/data/categories.ts` | Unchanged source fixture |
| `product/data/index.ts` | Unchanged source fixture |
| `product/index.ts` | Existing selected export facade retained |
| `product-category/data/index.ts` | Unchanged source fixture |

## Preservation gate

The promotion manifest retains exact source and target hashes and separately
classifies the thirteen `testPort` and two `testFixturePort` files. The verifier
transpiles source and target using the installed TypeScript compiler API and
compares executable syntax trees. Type annotations, type assertions and comments
erase; fixture calls, runtime imports, arguments, control flow, case names and
expectations must match. Unary operators, variable declaration modes and raw
template text are included explicitly because child traversal alone omits them.

The narrow exceptions are explicit named Vitest globals, exact Currency timeout
and static-import relocations for their designated files, and `void` references
to an immediately preceding local result declaration. Renamed Vitest bindings,
changed fixture calls, assertion values, skips, awaits, case names, imports,
operators and raw templates are rejected. No general source rewrite or weaker
assertion policy is admitted. The original byte-identical evidence is retained
separately; runnable copies are now maintained ports rather than described as
byte-identical upstream files.

## Validation

The initial full adapter run passed 212 cases but timed out in the Product
installation hook at the inherited 30000 ms deadline, leaving six declarations
skipped with a failed suite. Rechecking with `--hookTimeout=120000` passed all
17 files: 216 cases and two existing skips (227.695 s). The installation hook
now owns that allowance locally; a focused normal-configuration run verifies
the committed form without a CLI timeout override.

| Gate | Result |
| --- | --- |
| All ten Product files, PGlite | 205 passed; one upstream skip; 271.636 s |
| All ten Product files, ordinary-role PostgreSQL | 205 passed; one upstream skip; 274.455 s |
| Full default adapter suite, PGlite | 216 passed; two existing skips; 227.695 s, with setup timeout override as explained above |
| Product installation, normal configuration | 4 passed; two existing skips; 75.956 s |
| Live Currency, PGlite | 20 passed; 46.510 s |
| Live Currency, ordinary-role PostgreSQL | 19 passed; one existing driver-specific skip; 38.462 s |
| All four adapter TypeScript projects | Passed; 68.153 s |
| Three Currency editor test configurations | Each passed independently |
| Product and Currency builds | Passed; 0.852 s and 0.713 s |
| Source and promotion guard tests | 56 passed |
| Strict source-tooling JavaScript compiler | Passed |
| Pinned source verification | 8,496 files; zero symlinks |
| Promotion manifest and portable bundles | 370 files across ten packages; 641 portable inputs |

Both standing reviewers report no findings on the final code diff. The
TypeScript reviewer assessed 292 connected test/helper callbacks and the runner
and migration cancellation bridges; no Effect transformations were required at
these preserved framework/test boundaries. Main and independent reviewer
core/diff lint gates passed. The main thread's exact staged lint and whitespace
gates also passed before commit.

The owned PostgreSQL fixture was stopped and confirmed inactive after all
database checks. Full logs are retained under
`C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/validation/` with the
`test-cleanup-` prefix. Validation timings are receipts, not performance claims.

## Following work

This completes the promoted Currency/Product test cleanup. The proposed shared
metadata-driven adapter consolidation remains separately owned by
[Record 47](./47-medusa-shared-persistence-adapter.md). New modules, workflows,
stored Module Link, durable events, broader Payload integration and public or
production activation retain their own preflights and acceptance gates.
