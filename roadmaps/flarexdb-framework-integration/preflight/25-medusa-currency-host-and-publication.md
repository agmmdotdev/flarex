# Medusa Currency Host And Publication

## Status And Decision

Status: implemented private Currency capability on PGlite and ordinary-role
PostgreSQL.
[Record 24](./24-medusa-currency-convergence-and-schema-compatibility.md)
records the completed private source closure, actual DML value translation and
unchanged comparison baseline.

The implemented outcome is one working private Currency capability: compile the actual
model, install its reserved relational layout, seed the pinned 123 currencies,
admit a serving binding, and run the unchanged Currency service over Flarex.
Private repository writes must prove pending reads, rollback, one shared commit
and exact retained-result recovery. Installation, store, host and publication
are parts of this capability, not independent approval gates.

This tests the shared substrate with both framework ownership models before
general Payload compatibility. It does not activate a public adapter, Worker
route, Product, stored Module Link, workflow, arbitrary query language, existing
commerce database migration or cross-framework atomic transaction.

## Evidence And Design Challenge

The accepted [database design](../../../design-notes/flarex-db-accepted-design.md),
[commerce/CMS cutline](../../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
and [Medusa adapter design](../../../design-notes/flarexdb-medusa-commerce-adapter.md)
retain one transaction/publication substrate and distinct semantic owners.
Medusa owns Currency behavior; Flarex owns storage authority and settlement.

### Shared metadata, adapter-owned compatibility

Restrict runtime admission to the selected Currency proof without specializing
durable core metadata for Currency. Module business tables are generated from
actual DML. Shared relational change facts identify the installation, artifact,
table, versioned canonical primary key, operation and commit. The issuer validates
the key against the admitted table/key descriptor, including ordered components
and types; an arbitrary JSON key or a hash alone is not accepted identity.

Shared initialization receipts identify the installation, step, admitted
contract, dataset digest and verified completion. Currency's adapter owns its
default dataset and expected count of 123; core validates completion against that
captured contract, rather than placing the number in a database constraint.
Initialization receipts outlive ordinary commit-history retention.

The private runtime currently admits one table with one text primary key and a
catalog of at most 256 rows. Shared key codecs validate declared ordered text
components; other scalar key kinds, multiple runtime tables and larger catalogs
require further admission. Read/count/delete inputs and nested command values
consume the same cumulative budget. Catalog size probes run before hydration;
writes return identities and recheck stored sizes before loading expanded values.
The byte probe conservatively bounds the whole admitted catalog, even for a
smaller selected page. This deliberate first-profile restriction is not general
Medusa query compatibility.

Cancellation closes the framework runner gate and joins started DAL/SQL work
before transaction cleanup. Uncooperative JavaScript continuations receive a
bounded cleanup wait and cannot start SQL after revocation. Publication drains
its current bounded statement and checks cancellation before the next atom.

Currency column names, code-filter normalization and Medusa query grammar stay
in the adapter. Core owns scoped physical operations, resource bounds, authentic
receipts and settlement. New modules extend their adapter descriptors and
compatibility proofs; they do not each add a fact table, initialization table or
commit-header column. New schema/query/transaction features still require their
own proven admission. This is not an unrestricted generic database API.

| Current source | Consequence for this capability |
| --- | --- |
| `medusa-currency/src/services/currency-module-service.ts` and `medusa-types/src/currency/service.ts` | The declared public service provides retrieve, list and list-and-count. Preserve its recursive lowercase normalization and errors; do not invent public create/update methods. |
| Unchanged Currency integration suite | Preserve 123-row count, code-array filters, uppercase lookup, `skip: 5, take: 1` returning `aud`, and projected `rounding` with its `raw_rounding` companion. |
| `medusa-utils/src/modules-sdk/build-query.ts` | An omitted take becomes an undefined repository limit. Documentation mentioning a default of 15 is not evidence of this fork's actual behavior. |
| `medusa-currency/src/loaders/initial-data.ts` | The loader upserts the default catalog but catches errors. It remains comparison evidence; warning-only completion cannot authorize serving. |
| `medusa-utils/src/modules-sdk/decorators/inject-transaction-manager.ts` | A truthy context manager bypasses opening another transaction. Every target repository operation must authenticate the manager, rather than trusting the decorator. |
| `relationalTransaction/lifetime.ts` and `model.ts` | The current store admits a single system-owned scalar table and a 32-row keyset page. Currency requires a distinct selected profile with numeric, JSON, timestamp, default, projection, offset and count semantics. |
| `migrationCoordination/canonical.ts`, `schema.ts`, `storedValidation.ts`, `storedRestoration.ts` | Live fresh admission requires an authentic matching commerce descriptor. Cold stored plans are evidence only until reaffirmed by the exact freshly captured plan; persisted labels cannot mint authority. |
| `commitPublication/collection.ts` | Synthetic mutation receipts deliberately reject finalization. Preserve that denial; a successful Currency participant needs its own authenticated closure. |
| `pointCommitTransaction.ts` | Application, CMS and commerce share publication atoms. Commerce contributes typed relational facts through an admission-bound single-use closure; code keys are never fictitious document IDs. |

The repository's Convex `crates/database/src/transaction.rs` requires completed
nested work before producing a final transaction; `committer.rs` separates
durable persistence from visibility. Keep that outer-settlement discipline.
Flarex's accepted commerce profile uses trusted bounded SQL, so copying Convex's
document/OCC implementation into the Medusa adapter would change the design.

### Currency events are not a prerequisite invented by the adapter

The admitted Currency public service is read-only. The initial-data path calls
the internal service directly. Neither establishes a required Currency domain
event contract. The source audit also identifies generic generated event
extraction using `entity.id`, while Currency's primary key is `code`.

Admit typed Currency **row changes** for seed and private repository mutation
proofs. Admit no Currency domain-event family in this capability. A nonempty
event handoff must fail the transaction before settlement, never disappear or
reach an external bus. Seed does not synthesize 123 commerce events. This meets
the adoption rule to admit only events required by pinned behavior and leaves
actual module event identity/delivery for the first service that requires it.
It does not claim full Medusa event compatibility from Currency conformance.

## Installation And Serving Authority

Use the existing actual-model translator and physical lowering. The private
composition registers one closed Currency descriptor containing exact source,
artifact, layout, query/store contract and seed-dataset identities. Registration
is a trusted code boundary; receiving an artifact or a matching profile string
from a caller is not authority. Core consumes captured value contracts and
never imports Medusa or maintains a second hand-authored Currency schema.

Use the explicitly named registered-commerce-fresh migration profile through
plan capture, persisted constraints, restoration, readiness and binding
validation. Preserve existing synthetic and Payload profiles and their proofs.
Reject other Medusa artifacts, altered capabilities and semantic upgrades.
Use the existing coordinator and its bounded plan execution; do not execute
legacy MikroORM migrations or allow framework startup DDL.

Separate structural installation from seed completion. After structural
readiness, a fixed bootstrap command authenticates the exact installation
under scope-first locking without requiring an already serving commerce
binding. It writes the normalized pinned catalog, seed receipt, Currency facts
and retained bootstrap outcome atomically through the same commerce participant
used by later writes. The receipt pins dataset identity, count and installation.
Only then may binding selection admit serving with that exact seed receipt.

A crash after DDL leaves an unserved installation that bootstrap can resume.
A failed seed rolls back fully. A crash after successful seed resolves its
retained result and receipt without replaying upserts. Reconstructing a service
instance does not reseed. Existing rows without the matching bootstrap receipt
are a mismatch, not permission to merge an unknown catalog.

## Bounded Repository And Service Composition

Keep `CurrencyModuleService`, the actual model, mature internal service and
instance-scoped static composition. Implement the selected DAL beneath them.
Comparison repositories remain separately named test lanes with no target
fallback. Ordinary target DML uses the admitted layout and scope, never
caller-provided SQL, physical names or a raw database handle.

Implemented closed Currency budget: at most 256 stored rows including soft-deleted
rows; at most 256 result rows and code operands; offset 0 through 255; explicit
take 0 through 256. Omitted take returns the admitted matching catalog rather
than silently truncating at the synthetic store's page size. Enforce the
catalog bound on writes under the scope lock and detect oversized stored state
with a bounded overflow probe. Counts include all matching rows before paging.
Retain bounded calls, bytes, deadlines and cancellation; do not raise shared
synthetic limits. Seed writes use bounded batches, not one transaction per row.

Support selected code equality/inclusion, bounded recursive `$and`/`$or`,
active/deleted selection, whitelisted projections and deterministic code order.
Bound filter depth to 8 and total predicate nodes to 64. Reject unsupported
fields, operators, relation population, arbitrary repository options and sort
shapes before SQL. Preserve the unchanged pagination result with explicit
code-ascending default order; support code descending when requested.

Preserve numeric precision and `raw_rounding` behavior, timestamps, defaults,
nullability, soft-delete filtering and selected DTO serialization through the
mature service. Do not silently coerce arbitrary JSON/numerics or expose scope
columns. Private internal upsert/update/delete/soft-delete/restore proofs use
code identity; they do not extend the public Currency service interface.

## Transaction And Publication Ownership

Standalone service reads acquire one admitted bounded snapshot. Mutating
commands and seed use one Flarex-owned physical transaction: scope clock first,
then installation/binding evidence, then reserved-row work. A request manager
is an opaque locator for that exact lifetime, scope, installation and command.
Reject foreign, forged, stale, cross-instance and already-closed managers on
every operation, including read and nested transaction entry.

Nested service work borrows the same manager and sees pending writes. It cannot
commit or open an independent escape transaction. An inner failure latches
outer rollback even when application code catches it. Await all tracked work
before closing; preserve the existing cancellation, drain, quarantine and
uncertain-settlement rules from the shared session owner.

The private commerce participant collects typed relational row receipts.
Receipts bind exact transaction/admission, physical table, code, operation,
command order and affected-row evidence. Reject missing, duplicate, foreign,
reordered or unconsumed receipts. Preserve the synthetic rejecting collector.
Freeze the complete ordered closure before the outer finalizer accepts it.

The common publication owner writes one scope commit containing separately
typed relational row facts for Currency, one canonical retained command result, one existing
commit wake and one scope-clock advancement in the same transaction as rows
and initialization receipt. Add shared relational fact storage and one explicit
relational header count; update schema installation, restoration, feed readers and retention
consumers so existing Application/CMS readers do not misinterpret a commerce-only
commit as corruption or lose its facts. Do not overload application row facts,
Payload preference facts, the wake's event kind or Application journal authority.

Keep Application/CMS preparation and authority checks with their current
participants. Share the actual publication atoms through a closed contribution
contract rather than duplicating the commit tail or exporting a general
transaction/finalizer callback. Read-only commands emit no commit or wake; keyed execution refuses read-command tokens.
Each successful mutating command has one retained outcome, including a
successful no-op; failed commands have none. Ordered row facts reflect actual
affected rows, not attempted zero-row writes.

Request identity binds command, canonical arguments, scope and selected
authority. Same-request replay returns the retained result without service
re-execution; changed input fails. Uncertain COMMIT uses a fresh authenticated
session to resolve durable evidence and never retries an unknown write blindly.
No remote event delivery or workflow runs inside this transaction.

## Implementation Map And Alternatives

Paths below are relative to `packages/` unless stated otherwise.

| Owner | Disposition |
| --- | --- |
| `medusa-currency`, promoted `medusa-utils` / types | **Keep** mature semantics and unchanged baseline; **port** only selected DAL behavior whose compatibility is required. |
| `medusa-adapter` | **Rewrite** the target persistence seam with scoped composition, closed query/value decoding, authenticated manager and explicit bootstrap; **keep** comparison support isolated. |
| `persistence-postgres/frameworkSchema` and `migrationCoordination` | **Rewrite** the selected admission branch for the live fresh profile and seed-gated serving evidence; **keep** unrelated admission strict. |
| `persistence-postgres/relationalTransaction` | **Keep** synthetic conformance; **port** reusable lifetime/receipt mechanics into the Currency participant without widening its existing profile. |
| `persistence-postgres/cmsTransaction` and session kernels | **Keep** CMS authority; **port** proven host acquisition, nesting and settlement mechanics into the private commerce host where contracts match. |
| `persistence-postgres/commitPublication`, `pointCommitTransaction.ts`, metadata/feed owners | **Rewrite** only the shared publication contribution seam; add typed Currency facts while preserving Application/CMS behavior. |
| Legacy Currency loader and ORM migrations | **Keep** comparison/provenance evidence. No temporary bridge into target installation or serving. |

A read-only adapter over manually seeded tables would not prove installation
or shared commit correctness. Broadening the synthetic SQL store would erase
deliberate authority limits. Copying the complete fork Drizzle backend would
bring unrelated modules and a second persistence path. Implementing generic
Medusa events now would invent a Currency contract. The selected direction
proves the actual service and shared core with explicit private boundaries.

## Capability Boundary And Efficient Validation

1. Actual DML produces a fresh live installation; failed/mismatched seed blocks
   serving, restart resumes safely and exact seed recovery does not overwrite
   later data. Another artifact/profile cannot obtain Currency authority.
2. All 13 unchanged Currency assertions pass through the real Flarex repository
   on PGlite and ordinary-role PostgreSQL. Label original ORM comparison results
   separately. Check numeric/projection/default/soft-delete behavior and every
   admitted query/resource boundary without weakening source assertions.
3. Private writes prove pending reads, nested rollback, scope/instance isolation,
   manager denial, complete receipt admission and rejection of event attempts.
4. Both drivers prove atomic rows/facts/outcome/wake/clock, stable replay and
   rollback at publication failures. Real PostgreSQL additionally proves
   contention, interruption and uncertain settlement on distinct connections.
5. Existing Application/CMS publication, synthetic rejection, metadata upgrade,
   feed decoding and retention proofs pass for the changed shared owners.
6. Strict target typecheck, source/promotion guards, applicable lint and both
   standing source reviewers pass; roadmap evidence and exact manifest changes
   land with one coherent implementation commit. No production claim follows.

Use one driver-parameterized scenario set and the existing fixture/session
support. Read assertions share one seeded suite instance; mutation scenarios
reset only owned state. Allocate extra instances/connections only for isolation,
contention or failure-settlement tests. Run focused tests during development and
the affected shared preservation lanes once after integration; do not rebuild
the comparison island or rerun unrelated PostgreSQL suites after each edit.
Record setup, execution and total wall time separately. Missing native database
access leaves its acceptance explicitly incomplete, never inferred from PGlite.


Continuation: [Internal Product preflight](./45-medusa-internal-product.md)
implements the approved private text-pattern predicate in the shared commerce
store. Scope, resource and transaction ownership are preserved.
[Record 46](./46-commerce-command-registration-bound.md) completes the separately
approved command catalog limit and the final 23 internal Product cases. The
active Product gate is all ten inventoried files: 205 original passes plus one
retained upstream skip on PGlite and ordinary-role PostgreSQL. Test cleanup and
promotion policy discussion follow this compatibility checkpoint.
