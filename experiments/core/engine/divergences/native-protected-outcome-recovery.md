# Protected native historical outcome recovery

Status: **Selected native authority adaptation and connected recovery proof
complete; broader retained-consumer migration remains open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/application/src/application_function_runner/mod.rs` resolves an
authenticated recorded session result before mutation execution/permit.
`crates/model/src/session_requests/mod.rs` supplies the logical request index
and transactional result. Copy this committed-first mechanism.

The protected native
[LB4 contract](../../../../roadmaps/shared-logical-storage/reference-schema-binding-lifecycle-preflight.md)
also requires historically correlated outcome recovery after binding/preference
withdrawal. Historical disclosure authority is not current writer authority.

## Replacement and guarantees

Connect protected historical authentication/correlation to existing Core
resolve/recover owners before requiring fresh live native admission. Return a
matching committed outcome without Worker/native replay or restored writer
authority. Only a genuinely absent outcome proceeds to current binding admission.
Do not globally weaken direct-native request authentication or introduce another
outcome engine.

The [Core database](../../../../packages/persistence-postgres/src/core/database.ts)
issues historical correlation over its existing resolve/recover functions.
The [native Application profile](../../../../packages/persistence-postgres/src/application/coreNativeMutation.ts)
selects that owner before acquiring a fresh native binding or invoking a Worker.
Its root identity includes the authenticated immutable program, selected native
definitions, policy/principal contract, command registrations and limits.

Keep consumed authorization/schema dependencies selective and ABA-aware.
Unrelated/unconsumed compatible changes remain permissible; incidental whole
schema-head invalidation is not equivalent. Explicit global authority epoch
revocation remains a consumed live dependency. Ordinary schema handoff does not
advance that epoch implicitly. Historically authenticated committed disclosure
alone precedes this live revocation gate and never restores its grant.

[Protected authority](../../../../packages/persistence-postgres/src/core/protectedNativeAuthority.ts)
uses authenticated current source meaning, consumed table contracts and exact
chosen index generations, while the existing write log retains metadata ABA.
Standalone protected read completion validates the metadata suffix and preserves
its fixed business snapshot. The selected Application grant conservatively
consumes its table's full validator; field-level validator reuse is not claimed.
Existing exact observation, cancellation and single-root settlement owners remain
responsible.

## Required proof and limits

Prove lost acknowledgement then withdrawal then cold committed recovery, zero
callbacks/events replayed, denied foreign historical correlation, genuinely absent
outcome refusal under withdrawal and unchanged fresh direct-native admission.
Include selective metadata/ABA and protected read/save/reverse races, both
databases and the actual existing Worker composition. Add exact owner links
before implementation claims.

