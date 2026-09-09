# Complete public Product Categories compatibility slice

Status: complete private compatibility slice; validated and reviewed on both drivers.
Baseline `2f2561d1`; pinned Medusa `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Findings and bounded plan

The complete 21-case public Category suite requires the specialized Category
service, not the generic internal service previously used for root-only cases.
The pinned specialized service already has portable repository branches for
ranking, moves, descendant mpath updates, tree assembly and leaf deletion.
Promote those existing branches into the private Product package, retaining
business algorithms and selecting out MikroORM-only paths. Keep the original
21 assertions and shared Category fixture byte-identical and record provenance.

Implement a narrow tree repository adapter for scoped scalar reads, inverse
Product projection, prepared Category insertion, reference-only pivot attachment,
keyed updates and leaf removal. The specialized service owns tree/ranking rules.
Admit its validated parent reference in the adapter-owned profile through the
existing core reference-column capability. Core sessions, commit compilation,
managed timestamps, facts, resources, deadlines and publication remain unchanged.
Do not add a parallel tree or transaction engine. Validate tree safety and external
field admission at the adapter command boundary; arbitrary mpath and cycles are
not caller authority. Category soft deletion/restore remain unadmitted.

The old root-only adapter ranking must retire when the specialized service takes
over; do not rank twice. Preserve original module Category event semantics while
authenticating all changed row facts, including rank and path maintenance.

## Completion gates

Focused 21 originals plus five scope, rollback/replay, pivot, batch and tree safety guards on
PGlite and ordinary-role PostgreSQL; combined 151 originals plus one retained
upstream skip on both. Run strict authored-code compilation, source/provenance
and portable bundle gates, Currency regressions, main and staged lint gates, and
both required read-only reviewers. Stop the owned PostgreSQL fixture and commit
only owned files. Any shared-core defect requires its own documented preflight
and approval before correction.

After this slice, 54 declarations remain in the two internal Product/Category
files. Workflows, Module Link, durable events, public serving, broader Payload
integration and production retain their independent gates.

## Adapter diagnostics and representation preflight

Initial unchanged-source run: 16 of 21 pass on PGlite. Four rank/deletion cases
expose missing adapter mutation callbacks for service-owned maintenance writes.
The repository now dispatches the pinned callback for those actual updated rows;
the existing message aggregator deduplicates identical single-root messages.
The ancestor case exposes an own `parent_category: undefined` lost by the existing
JSON capture boundary. Keep core JSON unchanged and encode Category read DTOs as
an adapter-owned payload plus exact omitted-property paths, decoded at the foreign
service boundary. The decoder restores recorded representation only; it does not
infer tree membership or business results. Generic Category mutation replies and
other module replies retain their prior representation.


## Source closure and retired paths

The specialized Category service is a selected-export promotion of the pinned
portable branches. It retains the source ranking, move, descendant and deletion
algorithms; MikroORM imports/branches and the unadmitted soft-delete/restore
closure are excluded. Import relocation uses existing portable utility owners.
The Categories original and full Category fixture are copied byte-identically.
The promotion manifest authenticates source and target hashes and build outputs.

The generic root-only Category service and adapter ranking path are retired from
the Category composition. The adapter-owned profile now declares the parent
reference through the core's existing scoped reference-column capability.
No shared-core implementation, authority or resource limit changed.

The first full focused lane passed 25 cases on each driver. Review additionally
identified the pinned service's `__root__` rank-scope sentinel: caller IDs and
parent IDs using that spelling are now refused, alongside dotted IDs, so the
source algorithm cannot conflate root and child rank buckets.


A focused ordinary-role PostgreSQL reproduction confirmed `receiptMismatch` when
one Category create batch inserts two rank-zero roots after an existing root:
the existing root has two actual rank updates, while Medusa aggregates its update
event. The affected owner is the adapter's `productLocalEventPolicy`, which had
required unique update fact identities. Its Category-command-only validation now
requires one aggregated event for repeated Category updates and preserves every
core fact. Other commands, other entities, duplicate messages, missing messages
and lifecycle observations retain their prior checks. The fifth guard verifies
five published facts, three events, final ranks and replay, plus negative event
validation. Core publication remains unchanged; both-driver proof is required.

The earlier authored root-only test now retains its rank, forged-mpath and forged
batch-event checks; its obsolete refusals for parent/rank mutation are retired.
The unchanged original suite and new boundary guards exercise those admitted
operations positively. No original upstream assertion was changed.


The portable bundle gate also caught framework type-only imports retained as
runtime imports in the promoted service. Explicit type imports now keep that
closure out of the browser graph. The source-selected business implementation
is unchanged; the Product build and refreshed 640-input browser bundle pass.


The broader local regression lane exposed a pre-existing test projection mismatch
from the Collections admission: its creation DTO includes `products: []`, while a
Product's unpopulated Collection relation has scalar fields only. The source
Collection creation path and existing Collection composition are unchanged by
this slice. The authored assertion now checks the empty creation relation and
exact scalar Product relation separately, preserving all identity and event
checks. The other 32 local cases passed on the diagnostic PostgreSQL run.


## Next bounded preflight

The historical inventory now leaves exactly two unregistered internal-service
files under the pinned Product integration tests: `product.spec.ts` with 23
declarations and `product-category.spec.ts` with 31. Preflight their actual
repository, lifecycle and module-linkable requirements against this committed
baseline before admitting either file. These are static declaration counts, not
newly executed tests or proof of internal-service parity. Complete public test
files do not activate workflow, Module Link, durable events, public serving,
broader Payload integrations or production.


## Final validation receipts

Both required reviewers cleared the final implementation and authored tests,
including repeated Category update-event authentication, explicit type imports,
the checked codec fixture and exact Collection projection assertions.
No shared-core owner correction was required.

| Lane | Ordinary-role PostgreSQL | PGlite |
| --- | --- | --- |
| Categories, final source | 26 passed; 86.77 seconds | 26 passed; 119.19 seconds |
| Eight-file combined Product | 151 passed, one upstream skip; 195.18 seconds | 151 passed, one upstream skip; 203.81 seconds |
| Local Product transaction regressions | 33 passed; 93.76 seconds | 33 passed; 128.77 seconds |
| Currency regressions | 19 passed, existing driver skip; 51.03 seconds | 20 passed; 49.15 seconds |

The combined PostgreSQL run loaded the pre-type-import build. The final focused
26-case PostgreSQL run, both local transaction runs and combined PGlite run
validate the corrected import closure. The reviewers confirmed those imports
have no Category business behavior. No original assertions or execution-count
gates were weakened. All durations above are Vitest wall-clock receipts, not
performance claims.

- Query, value-profile, runtime-metadata and Category projection units: 54 passed.
- Source-boundary and promotion guards: 38 passed against the final source.
- All three strict adapter compiler projects and source-guard JavaScript
  compilation passed against the final source. Original test files retain the
  established runtime/source-hash compiler policy.
- Product build passed; source/island and browser bundle gates passed across
  640 inputs, with no Node, ORM, database or source-island runtime imports.
- Promotion provenance: 354 files across ten private packages authenticated,
  including source and available build-output hashes.
- Pinned source verification: 8,496 files, zero symlinks, unchanged fork revision.
- PostgreSQL 18.3 role has superuser, createdb, createrole and bypassrls all false.
  The owned fixture was stopped after the last PostgreSQL run; `pg_ctl status`
  confirms no server running.
- Main and independent reviewer core/diff lint gates passed.

The byte-identical Categories original has SHA-256
`e8bef28367a3bea5f4888baea12aabdabcd94ff3f265783241b01bf6a6f56bac`;
its byte-identical Category fixture has SHA-256
`86a83b8341e5aa49f88a509b2a938ec4a3f60bf1146c76ed026738d55ea655b0`.


Continuation: [Record 43](./43-medusa-internal-product-and-category-preflight.md)
completes the static preflight of the remaining 54 internal declarations and
recommends Category (31) first, then Product (23). It adds no runtime coverage.
