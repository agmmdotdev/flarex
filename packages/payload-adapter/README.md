# `@flarex/payload-adapter`

Private Payload compatibility and runtime composition over Flarex-owned CMS
capabilities. This package owns the exact Payload release profile, Local API
adapter boundary, request normalization, and response/error projection. It
does not own SQL, transaction settlement, Application materialization, commit
publication, or production routing.

The profile subpath also issues the opaque exact-content token required by
Payload lifecycle binding admission. That token carries no database, migration,
settlement, or publication capability.

`internal/runtime` exposes `makePayloadRuntime(profile)`: a scoped instance with
the six admitted commands and `bind(hostInput)`. It installs no scenario hooks
and exposes no raw Payload instance or test counters. The JSON command-host
contract remains unchanged; operation-specific input and result decoders retain
types inside the adapter.

`internal/testing` exposes `makePayloadConformanceRuntime(profile)`. Its
`runtime` uses the same source-private construction and lifecycle, while
`observations` and `payload` support the fixed nested-failure, replay,
interruption, and raw-instance probes. This is test support, not configurable
user hooks or a public-serving API.

Internal responsibilities are explicit: `composition.ts` owns instance lifetime,
`inputs.ts` owns ordered command admission, `operations.ts` binds native Local
API calls, `results.ts` captures typed result envelopes, and `query.ts` shares
primitive constraints without merging caller and sanitized adapter boundaries.
Native Payload validation/defaults and the existing authenticated loader path
remain separate owners.
