# CE2 Exact Unique Constraint Selection

Status: implemented under the owner's standing core-redesign approval.

## Outcome And Evidence

Before changing unique-build coverage, make the issued unique-definition port
prove the complete touched-table selection against the existing closed unique
constraint set. The primitive inner join can return a successful partial set when
a binding disappears. Eligibility already verifies the full closure on its own
path; this is a writer-selection contract correction, not a claim that every
current publication path bypasses eligibility.

Unlike developer indexes, private unique declarations are sealed by
`appUniqueConstraintSetClosureV1`, not compiled from manifest indexes. Reuse that
owner and its canonical members. Share the existing build owner's exact member
comparison with serving selection rather than inventing another closure codec.

Retain at most one successfully verified closure per issued port, keyed by
deployment and schema. Continue reading scope ownership and touched definitions
on every call. Compare count, physical and logical identity, table and verified
physical specification digest. Missing closures return unavailable; failed loads
are not retained. A closed empty set remains valid. Empty touched-table requests
retain the lower-level no-work result after scope verification. Retained metadata
does not confer activation, eligibility, transaction or settlement authority.

Canonicalization separates invalid members from an unavailable digest provider.
The protocol owner exposes one typed Effect operation; closure preparation and
reading project validation failures to corruption and digest failures to a
resource error with the original cause. This replaces the prior Promise boundary
that mislabeled read failures as corruption and preparation failures as defects.
Ownership evidence and Query/Action/Task invocation projections retain resource
or unavailable classification and the original cause. Resource classification
does not grant automatic retry; the existing planner retry policy remains intact.

## Alternatives, Breaks And Cleanup

Do not rely on the inner join alone or rebuild the entire closed set on every
warm selection. Do not introduce a second unique declaration authority, change
unique semantics, or replace current ownership reconciliation with ordered-index
history. Keep the primitive reader's lower-level role.

The issued writer port now requires a closed set even when the requested table
has no constraints. Propagate existing closure failure types through shared
materialization and point-commit contracts. Update any affected fixtures to close
their intended sets. Remove the build-local duplicate member comparison when
moving it to the closure owner. No physical migration, data deletion, Medusa
integration or unique-build maintenance cutover belongs to this slice.
The private canonicalizer now returns an Effect instead of a Promise; migrate
its closure owner and three test consumers directly, without a compatibility
wrapper. Its canonical bytes and digest remain unchanged.

## Completion Gates

Use one shared PGlite/ordinary-role PostgreSQL scenario for cold and warm missing
bindings, altered identity/specification, extra members, exact touched subsets,
empty sets, missing closure, scope mismatch, limits and schema replacement.
Observe that warm selection still performs only scope and touched-definition
queries. Preserve connected unique publication and build regressions, affected
failure-and-retry witnesses for hashing during cold selection and preparation,
typechecks, lint and both project reviews. Reconcile current ordered-versus-unique
maintenance status in the owning notes. Unique progress writes and broader CE2
concurrency/measurement gates remain subsequent work.

This closes unique writer selection and its connected failure contracts. It does
not close the existing split-catalog activation stall documented in
[activation maintenance](./23-ce2-activation-maintenance-cutover.md); that core
transaction correction takes priority before the unique-maintenance cutover.
