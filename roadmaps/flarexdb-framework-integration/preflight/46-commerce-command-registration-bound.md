# Commerce command registration bound

Status: approved implementation and all required validation complete.
Implementation baseline: b0bc607e; archived draft baseline: 08a3c422.
The registration change and final 23 internal Product cases are approved and
implemented. The current Product gate is 205 original passes plus one upstream
skip per driver across all ten inventoried files.

## Reproducer and ownership boundary

The Record 45 implementation draft adds six fixed internal Product commands
to the existing 61 commands. The resulting 67-command catalog is rejected
during makeLocalCommerceHost composition, before any original test executes.

Owner: @flarex/persistence-postgres private commerce host.
src/commerceTransaction/host.ts:99 refuses when allowed.size exceeds
commerceLimits.calls (64), as part of its invalidAuthority check. The same
constant also bounds statement execution in store.ts. The scale profile's
request call budget does not change this host registration check.

Expected for the proposed compatibility slice: admit the six authenticated
fixed commands and run the complete original file through the existing host.
Actual: invalidAuthority at host composition; all 23 declarations skipped by
the failed beforeAll, then the exact coverage reporter rejects the run.
Evidence: external work/validation/internal-product-third-pglite.log
(80.547 seconds, zero original cases executed). This is a capacity admission
boundary, not a Product assertion failure or a text predicate failure.

AGENTS.md requires shared-owner defects/capabilities exposed by a system test
to be recorded and separately approved. Record 45 explicitly preserved limits;
its text-predicate approval does not admit changing this host registry bound.
Initial disposition: the shared host was left unchanged and the unfinished
adapter draft was archived. The user subsequently approved this follow-up;
the hash-verified draft has now been restored and implemented.

## Approved follow-up decision

Introduce one private commandDefinitions limit of 128 and use it only for
the host's authenticated command catalog size check. Preserve the existing
64 statement limit and every profile-specific per-request call, row, byte,
time and event bound. This separates two already distinct concepts: registered
operations available to a host and operations executed by a request.

Then resume the six fixed commands and finish Record 45's complete 23-case
slice, full 205-original gate plus one skip, and its adapter/lifecycle/event
regressions on PGlite and ordinary-role PostgreSQL in the same capability.

128 is the approved finite catalog ceiling that accommodates 67 definitions
without coupling registry growth to transaction execution budgets. It is not
a performance or production claim.

Alternatives challenged:
- Raising calls also expands statement execution: unnecessarily broad.
- Removing existing commands loses admitted compatibility.
- Grouping unrelated operations into caller-selected dispatch commands obscures
  the existing fixed-command admission boundary.
- Splitting this single compatibility host solely to evade its current bound
  does not prove the requested whole command catalog.

Keep the authenticated command tokens, name uniqueness/grammar, reserved name,
mode checks, immutable capture, scoped manager, settlement and execution bounds.
Extend only registry cardinality. No schema, migration, persisted contract,
public API, second transaction owner, workflow or Module Link storage change.

## Proof and recovery

Add focused host composition tests: 128 distinct authentic definitions admitted,
129 refused, duplicate names/unrecognized tokens/reserved names still refused.
Prove that executing commands retains the existing statement and request limits.
Run the approved original and boundary suites, compiler/provenance/bundle gates,
both standing reviewers and exact staged lint before the coherent checkpoint.

Historical draft recovery:
C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/internal-product-draft/
contains tracked.patch, seven new files, and receipt.json with baseline and
SHA-256 digests. Verify the receipt and git apply --check before restoring.
At the pause, the draft passed the three adapter compiler projects but had no
passing internal Product runtime proof. Its archived receipt records that
checkpoint only; the implementation and validation below supersede it. Fixtures
and original assertions remain unchanged.

General test cleanup and Jest/Vitest promotion policy remain deferred until
the user-requested remaining compatibility cases are complete.

## Approved implementation

The private host admits up to 128 authenticated command definitions. The new
commandDefinitions bound is used only at registration; statement execution
still uses 64 and per-request profiles retain their previous limits and
canonical contract bytes. The six fixed internal commands give Product 67
registered definitions.

All 23 original internal Product cases passed on PGlite and ordinary-role
PostgreSQL. The static linkable test uses the original Module implementation
and nine-entity metadata; no stored Module Link capability was added.

The actual generated MedusaInternalService(Product) owns create/update/query
and lifecycle semantics. Request-owned repository profiles separate ordinary
public calls, Collection membership, Category projection and internal Product.
Internal updates reuse the existing DML value profile, check scalar/selector
input, preserve original missing-ID errors, and use core writes. Empty create
image lists from the original fixture are admitted; nested internal mutations
remain refused. Raw scalar/array results and lifecycle tuples retain their
shape through the existing owned Promise/JSON boundary.

Searchable columns come from pinned Product DML and checked text columns.
The adapter owns q/fromEntity and percent wrapping; the shared store owns
textLikeAscii. Internal unpaged reads use the bounded 256-row profile instead
of the public 15-row default, preventing valid internal batches beyond 15
members from being reported missing. Public default paging is unchanged.
Nested Category and Collection projections retain required identities/FKs
derived from metadata, matching pinned nested projection behavior for both
public and internal calls. Existing public scalar-only projection stays bounded
to its previously admitted profile.

Direct internal mutations require zero public messages and complete, correctly
classified core facts. Internal lifecycle facts must match authenticated
observations with the correct operation, row identity and deleted timestamp.
Public events retain their existing policy.

Four dedicated boundary cases cover DML search/paging/count/relation/deleted
filters, a complete 16-row internal batch, scalar/array results with replay and
exact publication distinction, and invalid-array rollback plus lifecycle
cascades. The complete original file and three required data fixtures remain
byte-identical to the pinned source. The active declaration inventory now
contains ten complete Product files, 205 originals and one retained skip.

Test cleanup, Jest/Vitest migration and import/editor diagnostics are still
deferred. These results do not claim workflow, stored Module Link, general
Payload integration, public serving or production readiness.


## Complete original-case inventory

| Original file | Passed cases | Retained upstream skips |
| --- | ---: | ---: |
| product-module-service/events.spec.ts | 22 | 0 |
| product-module-service/products.spec.ts | 34 | 1 |
| product-module-service/product-types.spec.ts | 13 | 0 |
| product-module-service/product-tags.spec.ts | 15 | 0 |
| product-module-service/product-collections.spec.ts | 18 | 0 |
| product-module-service/product-options.spec.ts | 13 | 0 |
| product-module-service/product-variants.spec.ts | 15 | 0 |
| product-module-service/product-categories.spec.ts | 21 | 0 |
| product-category.spec.ts (internal Category) | 31 | 0 |
| product.spec.ts (internal Product) | 23 | 0 |
| Total | 205 | 1 |

Each row is a complete original file. Authored boundary tests are additional
coverage and are excluded from the 205-original count.

## Final validation receipts (2026-09-09)

The PostgreSQL fixture uses PostgreSQL 18.3 and an ordinary role without
superuser, create-database, create-role or bypass-RLS privileges. Heavy database
and compiler lanes run serially. Wall times below include each command's
startup and fixture work; they are validation receipts, not performance claims.

| Gate | PGlite | Ordinary-role PostgreSQL |
| --- | --- | --- |
| Core admitted writes, text predicates and registry/execution bounds | 6 passed; 32.088 s | 6 passed; 20.637 s |
| Internal Product originals and four boundary cases | 27 passed; 112.924 s | 27 passed; 85.635 s |
| All ten Product files | 205 passed, 1 upstream skip; 272.091 s | 205 passed, 1 upstream skip; 256.146 s |
| Local Product transactions and query/unit coverage | 132 passed (33 database + 99 unit); 140.781 s | 33 database cases passed; 105.778 s |
| Public Category originals and five boundary cases | 26 passed; 125.077 s | 26 passed; 123.735 s |
| Internal Category originals and three boundary cases | 34 passed; 142.627 s | 34 passed; 149.218 s |
| Live Currency originals and announcement regressions | 20 passed; 65.681 s | 19 passed, 1 retained driver-specific skip; 44.909 s |

Currency retains its pre-existing driver-specific skip. The 99 driver-neutral
query/unit cases ran once alongside the PGlite local gate; all 33 database
transaction cases ran separately on both drivers.

The registration regression admits 128 definitions and refuses 129, duplicate
and reserved names, invalid names and forged tokens. Nested calls retain the
64-call request budget, including the outer command. Store reads retain the
64-statement limit and refuse statement 65. Existing predicate admission and
scope proofs pass alongside this new case on each driver.

Source guard tests: 38 passed (4.785 s). The promotion manifest verifies 368
files across ten private packages, and the portable bundle verifies 641 inputs
(26.274 s). The pinned source verifies 8,496 files and zero symlinks. All four
new upstream files match their pinned source hashes; original assertions are
unchanged.

Both standing reviewers returned no findings on the final authored code/test
diff. The TypeScript reviewer assessed 27 connected operations, covering all
six commands, connected query/update/lifecycle behavior, decoder and runtime
boundaries, and the original and authored tests. Main core/diff lint and the
reviewer's independent core/diff checks passed. The main thread's exact staged
Oxlint gate passed for both changed scoped source files before commit.

Final compiler/build checks passed: all three adapter TypeScript projects
(71.927 s), persistence TypeScript (66.868 s), Product build (1.057 s), and
strict authored source-guard JavaScript checking (0.780 s).

The owned PostgreSQL fixture was stopped and confirmed inactive after all
database validation.

Full command logs are retained under
C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/validation/.


The local nested-projection regression exposed an older authored expectation
that omitted IDs/FKs. Pinned Drizzle medusa.ts:271-290 appends required populate
foreign keys and expands primary keys; :1702-1721 prepends root primary keys;
:2343-2350 retains related primary keys in a partial projection. Both retrieve
and list call that repository find path. The unchanged original public
Collection cases also require those keys. The authored local test now requires
exact root/related identities, foreign keys and the complete key set. This
corrects the local expectation without relaxing any upstream assertion or
inventing different retrieve/list projection behavior. Production code remains
identical to the complete 205-case and focused 27-case passing snapshots; the
local gate passed on both drivers with the stronger source-aligned expectation.
