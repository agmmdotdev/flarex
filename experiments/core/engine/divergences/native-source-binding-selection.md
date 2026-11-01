# Installed native source binding selection

Status: **Selected native authority adaptation implemented with connected
metadata, ABA and actual Worker proof; broader migration remains open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` resolves an
authenticated stored session result before current execution admission in
`crates/application/src/application_function_runner/mod.rs`; the session outcome
remains separate from current writer authority. Its database table/schema
metadata does not express the native requirement that a framework source stay
installed while its selected runtime binding is withdrawn.

The existing protected LB4 contract requires that distinction. Advancing a
global authority epoch revokes old handles but alone permits a newly constructed
binding to reacquire the same source. Withdrawal must remain authoritative after
cold reopen and new handle construction without deleting business records,
reference retention policies or historically correlated outcomes.

## Replacement and guarantees

Extend the authenticated schema bundle with optional `nativeBindings` entries
`{ sourceKey, selected }`. The compiler verifies that each distinct key identifies
an actual compiler-issued native source. The existing shared logical
prepare/build/activation lifecycle persists that selection as optional
`bindingSelected` native table policy, checked against the complete bundle proof
during registry authentication and publication.

Omission preserves the old selected default and frozen stored shapes. Explicit
withdrawal denies fresh native binding, live command/read/traversal authority and
new protected assignment through the withdrawn source. It does not remove the
installed source, data, ordinary indexes, foreign keys or existing protected
reference retention. Integrity may still inspect retained records through its
own trusted owner; no withdrawn writer or public reader is restored implicitly.

Historical committed outcome resolution uses its original authenticated source
and request correlation before fresh binding admission, as specified by the
[protected recovery adaptation](./native-protected-outcome-recovery.md). An absent
outcome still requires current selected authority. Re-selection is an explicit
authenticated logical lifecycle transition, never a fresh-handle side effect.
No physical table, alternative preference store or migration engine is added.

## Required proof and limits

Prove omitted-profile stability, forged/unknown/duplicate selector refusal,
selection policy bootstrap authentication, fresh bind refusal after withdrawal,
retained references and stored rows, lost acknowledgement followed by withdrawal
and cold committed recovery with no callback/event replay, and rejection of an
absent outcome under withdrawal. Exercise PGlite and ordinary-role PostgreSQL
separately, plus the actual protected Worker composition. This does not admit
arbitrary native schema conversion or grant withdrawn source access to callers.
