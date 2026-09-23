# Module-local foreign keys through shared logical storage

Status: focused execution preflight under the shared-storage standing approval;
reverse-index definitions implemented, completed builds and FK execution pending.

## Connected outcome and evidence

Admit normalized, source-local text foreign keys through the same logical row,
index, unique-claim, transaction and publication owners used by Currency. A
request may write child and parent rows in either order; final references must
resolve in the authorized scope. Parent removal must apply declared `cascade`,
`restrict` or `noAction` semantics, including self references and bounded
multi-level cascades. Conflicting parent deletion and child insertion must
settle as a conflict or valid ordered outcome, never a dangling reference.

The pinned Product graph declares 15 single-text-column FKs to primary `id`
columns: 11 cascades and four `noAction` references. Three child columns
(`product.collection_id`, `product.type_id`, `product_variant.product_id`)
have no unconditional first-column index. Reverse validation therefore needs
implicit source-owned logical indexes; a table scan would make parent deletion
cost depend on all shop rows. The current relational row policy refuses every
FK, while the existing Application edge policy accepts internal document IDs
and restrict-only deletion. Merely passing native FK strings to that policy
would neither resolve target identities nor implement native cascades.

## Owner and replacement boundary

The shared requirement compiler derives one stable reverse index where a
declared FK source prefix lacks an unconditional index. Source admission and
build/readiness authenticate it like other logical indexes. The request-owned
logical working set resolves native keys to final scoped rows, collects bounded
reverse memberships, applies native cascades, and refuses missing targets or
remaining `noAction`/`restrict` children. Its captured point/index dependencies
are revalidated under the outer publication exclusion before one settlement.
No framework callback, separate transaction, physical Product SQL or scan
fallback belongs in this core policy. The final row and derived index delta
remains the single source of committed facts.

The index prerequisite is now implemented for single-text-column FKs: Product
adds exactly three reverse access paths to its 56 native ordered declarations.
The shared reader recognizes those prefixes, and whole-candidate installation
records their definitions without Product DDL. Completed Product index builds
and serving coverage have not been proved. This does not grant FK serving
authority; source-local existence, deletion and cascade execution remain the
next gate.

This deliberately moves FK refusal out of row-local value normalization and
into whole-source relation admission. The internal row-policy call contract and
generated index set may break; Application/Payload document relations and
Medusa's rich Module Links retain their current semantics. Product's physical
consumer remains named until its complete graph, query and workflow gates pass.
Existing prepared Product candidates need their requirement set rebuilt from
the authenticated source. No Product logical FK writer is currently admitted,
and no populated physical Product data is removed in this slice.

## Gates

Use a neutral source with nullable and required references, same-request
parent/child writes, missing target, parent restriction, cascade chain and
self-reference cases. Prove pending reads, rollback, replay, two scopes and a
parent-delete/child-insert race on ordinary-role PostgreSQL; run the same
functional path on PGlite. Check all pinned Product FK shapes and implicit
reverse indexes, then exercise a real native Product command before selecting
the complete Product profile. Retain an explicit bounded-overflow refusal and
measure fanout separately from correctness. Both required reviews, typechecks,
focused regressions, staged lint and cleanup precede each commit.

Advanced populated-data conversion, cross-framework endpoint authorization,
rich Link semantics and general upgrade orchestration retain their separate
gates. A source with unsupported composite/non-text FK or deletion policy
must refuse before exposing a table operation.
