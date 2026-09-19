# Native Invocation Attribution Before Concurrent Publication

Status: implemented for the existing native acceptance fixture. The
[source-execution extension](./35-ce0-native-workerd-attribution.md) replaces
the scripted measurement body with local Workerd. Hosted attribution and a
complete-request reference remain open.

## Decision And Boundary

Unlocked binding preparation does not remove the main clock's protection of
current dependencies, command decisions and sequence-bearing row/index writes.
The next concurrency protocol must coordinate these owners. Fill the missing
native invocation attribution before selecting that protocol: the existing
persistence-lifecycle fixture omits active admission, grant signing/verification,
execution-host preparation and request orchestration.

Exercise `invokeApplicationMutation` through the existing system-test composition,
real admission/crypto/journal/compiler/publisher and ordinary PostgreSQL, with
separately observed control and target pools. The fixture uses existing legacy
Application readiness; record and assert that profile instead of claiming the
new relation/CMS readiness path. Reuse the native acceptance harness
and its shared Miniflare Application Worker loader. The measurement executes the
registered insertion source in real local Workerd, including startup and the
test capability bridge. The scripted acceptance loader remains for named
failure-injection scenarios. Deployed scheduling, network transport, production
application capacity and an equivalent complete-request reference remain open
CE0 requirements.

## Owners And Measurement Contract

Reuse the persistence-owned pool observer and environment/provenance helper via
explicit internal system-test exports. Reuse the existing native harness loader,
live construction and durable counts rather than create another authority or
publisher. Existing Effect host spans partition admission, host execution and
finalization; these are client intervals, not server lock-hold durations. SQL and
socket bytes belong to each pool independently. The two elapsed times overlap
and must not be added.

Use a one-row public native mutation, one warm-up pair and five alternating
normal/instrumented pairs with equal argument values within each pair. Measure
duplicate replay separately and calibrate the
combined tracing/pool observer against normal invocations. Exclude fixture setup,
key generation, input creation and correctness readback from timing. Preserve
real COMMIT and inspect exact canonical row identity/content, dense sequences,
publication/outcome/fact/wake counts, unchanged replay and Worker invocation
counts. Compare row, index, unique/build, candidate, journal/session/lease/claim
and publication families before and after replay outside timing. Treat statement
verbs only as supplementary evidence and refuse unexpected replay CTEs in this
profile. Raw reports contain aggregate metrics, not tenant values or SQL text.

## Breaks, Cleanup And Completion

No production schema, lock order, API, execution semantics or durable data changes.
New exports are explicitly privileged test support; no runtime import or fallback
is permitted. Keep the existing broad native acceptance proof for conflict rerun,
duplicate refusal, stale authority, terminal failures and candidate guards in both
PGlite and PostgreSQL. Validate observer lifetime/cleanup, affected typechecks,
lint and both reviews. Stop owned resources, reconcile remaining attribution
limits and commit this coherent evidence slice. This does not authorize moving
materialization ahead of sequence assignment or mixing incompatible writer orders.
