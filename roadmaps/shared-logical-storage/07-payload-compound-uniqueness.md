# Payload Compound Uniqueness

Status: implemented for the admitted required-scalar Payload profile.

## Outcome And Owners

Execute multiple required-text unique fields and compound unique indexes through
real Payload Local API operations using the existing shared unique definition,
build, claim, pending-read and settlement owners. Analysis authenticates unique
index intent; the Payload compiler translates native declarations and the adapter
projects constraint failures. No adapter-owned uniqueness query or second engine
is introduced.

The existing core already supports compound claims. The Payload declaration owner
now uses deterministic descriptors derived from complete ordered field selections
instead of a single table-local descriptor. Ordinary ordered indexes remain for compound unique selections
so prefix/range queries continue to work. Canonical duplicate declarations merge
with uniqueness winning over an ordinary declaration of the same selection.

Pinned Payload 3.88.0 `sanitizeCompoundIndexes` retains the declared field order
and defaults `unique` to false. Accept only current flat required scalar fields;
individual uniqueness remains required text. Missing, nullable, localized,
conditional and decimal-projected uniqueness are outside this slice. In
particular Medusa's soft-delete predicate requires a subsequent explicit core
physical-spec contract; this slice does not claim generic Medusa execution.

## Cutover And Cleanup

The single-field admission, query and error-mapping assumptions are removed together.
The private declaration descriptor changes for new schema publication; existing
selected immutable definitions and claims are not rewritten or dropped. New
schema definitions require the existing build/readiness and activation gates.
No public developer API or physical platform migration is added. Any populated
schema transition still follows the recorded supported-transition policy.

## Completion Gates

Authenticate unique intent through compiler, Analysis and schema readiness; reject
missing/forged constraints. Exercise native create/update and field-level error
projection, compound equality/prefix reads, pending claim release/reacquisition,
whole-command rollback and replay. Prove independent compound keys and multiple
constraints on the same row, concurrent same-key refusal, unrelated-key progress
and scope isolation. Use PGlite plus ordinary-role PostgreSQL, affected typechecks,
lint and both read-only reviewers. Preserve the existing single-field regressions.

Native deletion's preference-cleanup lifecycle retains its separate integration
gate; core pending deletion may prove claim release without claiming that native
Payload deletion has acquired lifecycle authority.
