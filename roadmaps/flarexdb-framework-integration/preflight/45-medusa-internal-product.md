# Internal Product compatibility implementation preflight

Status: approved text predicate implemented; adapter completion paused at the
separate command registration bound in [Record 46](./46-commerce-command-registration-bound.md).
Baseline: e31385a0. Current gate: 182 original passes plus one upstream skip
per driver. Pinned Medusa: 48d5cc675e4e8bc821e22c20c88a751acc66fb5f.

## Outcome and scope

Finish the remaining complete internal Product file: 23 declarations. Retain
all original scenarios and assertions, and target 205 original passes plus the
existing skip on both drivers. Test cleanup, Jest migration, editor diagnostics
and the broader promotion policy discussion are deferred at the user's request.

The generated MedusaInternalService(Product) remains the implementation owner.
Reuse the existing trusted command host, scoped manager, graph storage and
managed lifecycle. No Product replacement class, raw manager escape hatch,
workflow execution, Module Link storage or public serving is added.

## Required shared-owner decision

The original free-text case creates "test product" and "space X" and calls the
internal list method with q: "test", then q: "space". Pinned Drizzle's
freeTextSearchWhere in packages/database/drizzle/src/medusa.ts:1616 selects a
matching freeTextSearch_* filter and uses SQL LIKE with percent signs around
the supplied text. searchableColumns derives the fields from DML; Product
declares title, subtitle and description searchable, but not handle.

Current adapter product-query-profile.ts accepts only the softDeletable options
filter. The shared commerceTransaction/store.ts parseRead predicate compiler
admits and/or, isNull, timestamp greaterThan and in. It has no text-pattern
predicate. These closed decoder branches establish the missing capability;
the 23-case file has not been registered or claimed as executed in this preflight.

Owner: @flarex/persistence-postgres private commerce store. Extending its
accepted read predicate is a new shared-owner capability. AGENTS.md's
Implementation Capability Preflight requires approval when crossing an owner
boundary. The prior Category implementation approval did not admit a core
predicate. Do not replace this missing capability with test-side filtering,
raw SQL access from the adapter or a weakened original assertion.

Recommendation: add one private, parameterized text-pattern predicate with an
explicit ASCII-insensitive, no-escape contract. Keep its admission with the
commerce store. Compile it through trusted column lookup, with ASCII-only
translate on both column and pattern, C collation and LIKE ESCAPE ''. Restrict
it to text columns. Preserve existing scope injection, catalog/query bounds,
filter depth/node limits, transaction lifetime and statement deadlines; charge
the pattern as a filter operand and retain command/row byte limits. Reject
unknown keys, malformed strings, wrong column types and unknown identifiers.

The adapter derives searchable columns from checked DML metadata and supplies
the percent-wrapped pattern. It owns Medusa's q and fromEntity validation.
The shared store owns only the declared text operation. No schema/migration,
commit/OCC, write, event-publication or transaction-owner changes are proposed.

## Alternatives challenged and SQL evidence

A ten-case Node SQLite/PGlite SQL probe ran in an external workspace, without
changing application or core code. Its proposed SQL matched SQLite in all cases.
This is a SQL semantic probe, not a completed adapter test or real-Postgres
validation.

| Probe | SQLite | Native PG LIKE | Native PG ILIKE | Proposed SQL |
| --- | --- | --- | --- | --- |
| Test product against percent-test-percent | true | false | true | true |
| Capital AE ligature against lowercase ae ligature | false | false | true | false |
| Literal backslash in value and pattern | true | false | false | true |
| Percent wildcard | true | true | true | true |
| Underscore matching a newline | true | true | true | true |
| Underscore matching an astral Unicode character | true | true | true | true |
| Quote/SQL-looking text supplied as a parameter | true | true | true | true |
| Null value | null | null | null | null |
| Empty search wrapped in percent signs | true | true | true | true |
| Nonmatching text | false | false | false | false |

Neither native LIKE nor ILIKE alone preserves the pinned SQLite behavior.
JavaScript substring matching also loses wildcard behavior. A separate raw-SQL
adapter path would bypass the existing scoped store contract. The recommended
predicate keeps one authority and one bounded query path.

Reproducer script:
C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/internal-product-like-preflight.cjs
The exact probe vectors and results are recorded in the companion JSON receipt.

## Adapter implementation after the owner decision

1. Add fixed private internal Product read/create/update/softDelete/restore
   commands, with request-owned service composition and the actual raw return
   shape. Do not route them through public module methods. Generic internal
   create/update/softDelete register a subscriber, while restore uses its existing
   dispatcher convention; direct calls still have no EmitEvents aggregator.
   Admit their precise zero-publication contract and authenticated lifecycle
   observations without weakening public event requirements or dropping row facts.
2. Validate external scalar and selector update forms; let the actual internal
   service build selector/entity-update pairs and its exact missing-ID errors.
   Translate its bounded generated $or primary-key selector through existing
   core OR/membership capabilities. Keep undefined-ID compatibility at the
   foreign boundary and preserve all-or-nothing missing-member behavior.
3. Add a Product-table scalar update DAL operation. Authenticate existing row
   identities and managed fields before writes. Keep public upsertWithReplace
   and graph mutation ownership intact; this file does not authorize arbitrary
   nested internal updates.
4. Extend checked Product projection for nested Category fields and retained
   primary/FK fields required by the original internal and public Collection
   cases. Preserve already-admitted scalar-only and relation projections.
   Verify exact pinned projection semantics before choosing the narrow profile.
5. Reuse the existing Module/linkable computation and pure joiner builder for
   the static nine-entity metadata case. Keep the Node model-discovery wrapper
   out of any portable runtime closure; do not hard-code the expected object.
6. Register the complete original file with source hash and exact case
   multiplicity gates. Retain the current promotion/compiler policy until the
   user's later cleanup discussion.

Keep: shared settlement, existing public commands, source business algorithms,
scope checks and original test assertions.
Extend: private commerce text predicates and bounded Product adapter operations.
Port: the complete original internal Product test and only necessary portable
static metadata mechanics.
Retire: the blanket runner refusal for the specifically admitted internal
Product property. No fallback or second query/transaction engine is retained.

## Exit criteria

- Focused core predicate tests on PGlite and ordinary-role PostgreSQL: ASCII
  case, Unicode case, literal backslashes, percent/underscore, null/empty values,
  quote/injection-shaped input, unsupported column types, excess fields,
  malformed Unicode/NUL, operand/depth/node limits and scope collisions.
- Adapter q tests derive DML fields, exclude non-searchable handle, combine
  scalar/relation/deleted-row filters and apply filtering before count/paging.
- Internal update rollback, source errors, scalar/array return forms, replay,
  lifecycle tuples, authenticated facts and exact zero/public event distinctions.
- All 23 originals, combined 205 originals plus the retained skip, and existing
  Product/Category/local transaction and Currency regression gates on both drivers.
- Strict authored-code and source-guard compilation, affected package builds,
  promotion provenance, source pin, portable bundle and main core/diff lint.
- Both required reviewers on the final code/test diff; exact staged gate before
  commit; stop the owned PostgreSQL fixture after validation.

No runtime source, test source, active case inventory or core owner was changed
by this preflight. The current gate remains 182 originals plus one skip.


## Approved implementation checkpoint

The private textLikeAscii predicate now uses trusted text columns and bound
parameters, ASCII-only translation, C collation and no escape character.
It charges one filter operand and applies the existing row-byte ceiling to
the pattern, alongside unchanged request bytes, scope, node/depth and query
limits. Find and count share the compiler.

The core test covers ten SQLite semantic vectors, filtering before paging,
count independent of paging, malformed predicate keys/types, unsupported
columns, NUL/invalid Unicode, row-byte and operand/node/depth limits, and a
colliding foreign-scope row. Invalid UTF-16 is refused at the existing outer
canonical command boundary before it can reach the store.

The original-file attempt exposed a separate 67-versus-64 command catalog
limit before cases ran. Record 46 owns that follow-up decision. The adapter
draft is recoverable externally; active promotion and case inventories remain
at nine Product files, 182 originals and the retained skip. No test cleanup
or assertion changes are included in this checkpoint.

Validation receipts (2026-09-09):
- commerceAdmittedWrites.test.ts: five passed on PGlite (22.900 seconds)
  and five passed on ordinary-role PostgreSQL 18.3 (17.995 seconds).
  The final vectors seed their own operand/scope fixtures.
- Persistence package typecheck passed (73.624 seconds).
- Both standing reviewers returned no findings on the final code/test diff.
- Main core/diff lint passed; promotion verification retained 360 files across
  ten private packages; source pin verified 8,496 files and zero symlinks.
- The owned PostgreSQL fixture was stopped after validation.
- The prior 182-original compatibility gate is retained, not claimed as rerun
  by these focused core tests. The 23 internal Product cases remain unexecuted.
