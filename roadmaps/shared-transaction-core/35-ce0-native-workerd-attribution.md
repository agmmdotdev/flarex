# Native Source Execution Attribution

Status: implemented for local native source execution. Hosted attribution and
an equivalent complete-request reference remain open.

## Outcome And Evidence

The native invocation measurement calls real admission, grant, host, journal
and publication owners and executes the registered source using the existing
`MiniflareApplicationWorkerLoader` from the native query harness. Its bridge
supports the Application mutation capability and is reused by relational, task
and application tests.
The registered fixture's `users:create` source inserts the supplied name through
the real Application runtime and journal capability.

Retain the same one-row workload, alternating normal/instrumented pairs,
separate control/target SQL observations, exact canonical result checks, dense
publication and unchanged duplicate replay. Count fresh loads and dispatched
revisions; replay must invoke neither. This remains a legacy-readiness native
fixture, not the generic three-framework serving destination.

## Ownership And Alternatives

Replace the measurement's scripted loader with the existing real loader. Keep
the scripted acceptance harness for its named conflict, stale-authority and
failure-injection scenarios; it is no longer the timed execution subject.
Do not duplicate the runtime, journal capability, transport codec or commit
logic inside a new benchmark implementation. No production API, schema, lock
order or durable-data change is required.

The reused loader captures disposal settlements immediately when the host
releases its result, then drains every released/live runtime before reporting
an aggregate of cleanup failures. This replaces unobserved rejected disposal
promises and fail-fast draining at the shared test-runtime owner. Existing query,
task and application consumers retain the same loader API; cleanup failures
now report together after all captured work settles.

The local test bridge starts a Miniflare/Workerd runtime for each invocation and
forwards capabilities through its service binding. Include startup, module/source
evaluation and bridge calls in the measured request; exclude awaited runtime
disposal from timing but complete it before the next sample so cleanup cannot
overlap paired trials. Report this boundary explicitly. These timings are not
deployed Worker scheduling, network, Hyperdrive or warm-isolate capacity.

## Validation And Completion

Run the real-source mutation measurement on ordinary-role PostgreSQL and the
existing real-Workerd PGlite query acceptance to cover the reused loader. Keep
native dual-driver acceptance, exact replay state, source provenance and observer
calibration. Validate affected types, lint and both project reviews, remove the
displaced scripted measurement path, await loader cleanup on success and failure,
stop owned runtimes/database resources and reconcile the attribution roadmap.
An independent complete-request PostgreSQL reference and hosted attribution
remain separate open CE0 gates; real source execution alone does not close them.
