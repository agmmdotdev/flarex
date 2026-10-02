# `@flarex/payload-adapter`

Private Payload compatibility and runtime composition over Flarex-owned CMS
capabilities. This package owns the exact Payload release profile, Local API
adapter boundary, request normalization, and response/error projection. It
does not own SQL, transaction settlement, Application materialization, commit
publication, or production routing.

The profile subpath also issues the opaque exact-content token required by
Payload lifecycle binding admission. That token carries no database, migration,
settlement, or publication capability.

`internal/collections` compiles the supported native scalar collection definitions
once. Pass its generated declaration through authenticated Application analysis,
publication, readiness, and activation; then give the same compiler-owned result
to `makePayloadContentProfiles(compiled)` and `makePayloadRuntime(compiled)`.
Structural copies cannot substitute executable configuration after compilation.

`internal/runtime` exposes a scoped instance with the six admitted commands and
`bind(hostInput)`, `bindRead(hostInput)` and `borrowParticipant(input)`. Every command input explicitly selects a `collection` slug,
for example `{ collection: "news-items", data: { headline: "Hello" } }` for create.
Collection selection participates in request identity and replay. It installs no scenario hooks
and exposes no raw Payload instance or test counters. The JSON command-host
contract remains unchanged; operation-specific input and result decoders retain
types inside the adapter.

`internal/testing` exposes `makePayloadConformanceRuntime(profile)`. Its
`runtime` uses the same source-private construction and lifecycle, while
`observations` and `payload` support the fixed nested-failure, replay,
interruption, and raw-instance probes. This is test support, not configurable
user hooks or a public-serving API.

The participant binding admits create, update and find-by-ID using the same native
instance and operation handlers. It borrows the Application root's lifetime and
pending view; deadline, close, abort and journal outcomes stay with that binding.
It cannot settle or publish the root. Product retains its existing update,
retrieve and list-by-handle methods.

Internal responsibilities are explicit: `runtime/native.ts` owns instance lifetime,
`direct/binding.ts` owns direct command hosts, `participant/binding.ts` owns borrowed
Application participant calls,
`inputs.ts` owns ordered command admission, `operations.ts` binds native Local
API calls, `results.ts` captures typed result envelopes, and `query.ts` shares
primitive constraints without merging caller and sanitized adapter boundaries.
Native Payload validation/defaults and the existing authenticated loader path
remain separate owners.

Scalar collection/field names are application supplied. ID and the one declared
unique text field admit equality queries; scalar `index: true` and ordinary
compound `indexes: [{ fields: [...] }]` admit equality prefixes and numeric ranges
on the next field. Native ID paging and complete counts retain the CMS matched-row
and byte limits; custom sorting and compound uniqueness fail closed. Bound table identity also
guards point reads and writes. Preference deletion authenticates the exact
pending document's native collection key. The fixed posts configurations and
identities live in `testing/profiles.ts`; `testing/conformance.ts` and
`testing/mutation.ts` own the fixed hooks, counters and revision profiles.
Relation/many/join capabilities remain
closed conformance regressions, not generalized authoring support.

Numeric writes and query predicates use positive zero after native validation.
The shared core retains exact signed floats. Retained negative-zero Payload rows
require an audited conversion and index rebuild before this storage contract is
adopted; runtime translation does not repair them.
