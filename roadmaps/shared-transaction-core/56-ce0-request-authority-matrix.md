# Request Authority Acceptance Matrix

Status: bounded cross-request authority matrix implemented; complete-request
CE0 acceptance remains open.

## Outcome And Owners

Extend the existing real metadata-change witness from empty mutations to
nonempty mutations and standalone reads. It changes generation, fence, epoch,
active binding availability/integrity, ordered bindings/definitions, unique
definitions and build certification between
preparation and physical transaction entry. Exercise core and independent
reference requests for fresh/replayed zero-row and eight-row mutations, empty
reads and populated point reads.

Require `bindingChanged` for a missing active binding and `invalidAuthority` for
the stale/corrupt authority cases before operation execution, even when a
durable outcome exists or the operation has no rows. Keep complete scoped
inventory and binding-head equality, other-scope isolation, exact injection counts and successful
restoration. This advances the stale-authority gate in the complete-request
comparison without replacing the common admission implementation.

## Design Challenge And Cleanup

Do not copy the mutation scenario into another helper or implement an independent
authorization rule in tests. Rename the existing empty-only boundary owner to
the request authority boundary owner and migrate its caller. Reuse its actual
metadata changes and physical-session decorator. Every profile delegates to the
real command or snapshot session; the decorator only schedules fixture metadata
changes after preparation and before entry.

Keep schema and build corruption witnesses physically valid and restore them in
finally blocks. Reference unsupported-input semantics are a separate remaining
gap, not a reason to skip authority checks for admitted operations. No production
API, data schema, lock order, authority contract or durable-data cutover changes.
Remove the old file/import instead of preserving a wrapper. Common authority
cost remains disclosed and cannot be independently attributed by this matrix.

## Validation And Completion

Run the expanded existing PGlite and ordinary-role PostgreSQL entry points,
affected types/lint and both read-only reviews. Check actual callback counts for
both read and mutation engines, unchanged full data inventories and no stranded
database resources. Reconcile roadmap claims, stop owned runtimes and commit.
Complete-request timing and broader operation/profile acceptance remain open.
