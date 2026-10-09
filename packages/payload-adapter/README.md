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

`internal/runtime` exposes a scoped instance with `bind(cmsCommandBinding)`,
`bindRead(cmsReadBinding)` and `makeAttempt(attempt)`. A command host has bound
`create`, `update`, `delete`, `find`, `findByID` and `count` methods; a managed
reader has only the three read methods. The ordinary instance exposes neither
command tokens nor persistence construction inputs. Every operation selects a `collection` slug,
for example `{ collection: "news-items", data: { headline: "Hello" } }` for create.
Collection selection participates in request identity and replay. It installs no scenario hooks
and exposes no raw Payload instance or test counters. Caller argument types and
native/replayed result types come from the existing ordered input and result
owners. Trusted construction uses Application serving and CMS binding factories;
the operation consumer receives only the issued binding.

```ts
const runtime = yield* makePayloadRuntime(compiled);
const host = yield* runtime.bind(commandBinding);
const created = yield* host.create(host.newRequestKey(), {
  collection: "news-items", data: { headline: "Hello" },
});
const document = yield* host.findByID({ collection: "news-items", id: created.id });
```

Request keys remain explicit for independently committed writes and replay. A
managed reader has no request keys, write methods or settlement capability.

`internal/testing` exposes `makePayloadConformanceRuntime(profile)`. Its
`runtime` uses the same source-private construction and lifecycle, while
`observations` and `payload` support the fixed nested-failure, replay,
interruption, and raw-instance probes. This is test support, not configurable
user hooks or a public-serving API.

The participant binding admits create, update and find-by-ID using the same native
instance and operation handlers. It borrows the Application root's lifetime and
pending view. CMS owns authentic command lookup, deadline, call closure and the
authoritative contribution/result/accounting completion. Payload retains method
selection, native error meaning and native-instance lifetime/abort retention.
It cannot settle or publish the root. Product retains its existing update,
retrieve and list-by-handle methods.

Internal responsibilities are explicit: `runtime/native.ts` owns instance lifetime,
`api.ts` names the admitted operations, `direct/binding.ts` binds them to issued
CMS capabilities, and `participant/binding.ts` selects borrowed native methods.
`inputs.ts` owns ordered command admission, `operations.ts` binds native Local
API calls, `results.ts` captures typed result envelopes, and `query.ts` shares
primitive constraints without merging caller and sanitized adapter boundaries.
Native Payload validation/defaults and the existing authenticated loader path
remain separate owners.

The private inspection functions in `internal/testing` retain exact native tokens
for custom nested commands, malformed-input, budget, index and publication-fault
witnesses. Ordinary runtime code does not import test support. The construction
boundary check includes type imports, re-exports and source-relative bypasses.

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
