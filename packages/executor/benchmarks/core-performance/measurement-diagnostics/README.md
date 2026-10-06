# CPU and PostgreSQL measurement completion evidence

These are unchanged successful reports from the 2026-10-06 measurement SDK
completion slice. Each gzip restores the original bytes; Markdown reports are
copied unchanged. The source directory was
`work/validation/measurement-completion/`. Earlier development runs that failed
source stability, provisioning or plan-format validation are excluded. The
[earlier SDK](../measurement-sdk/README.md) and
[operation-context](../measurement-operation-context/README.md) reports remain
immutable.

| Lane and graph | Original report | Raw JSON gzip | Recorded result |
| --- | --- | --- | --- |
| PGlite CPU, Application-only small | [report](10e61a12-d9a2-400c-87b1-13d4f722fc2c.md) | [raw](10e61a12-d9a2-400c-87b1-13d4f722fc2c.json.gz) | Complete; acceptance not evaluated |
| Ordinary-role PostgreSQL CPU, mixed Product small | [report](d72eeb45-935f-4782-8050-abc2246653e0.md) | [raw](d72eeb45-935f-4782-8050-abc2246653e0.json.gz) | Complete; acceptance not evaluated |
| Ordinary-role PostgreSQL server, mixed Product small | [report](592705ed-b789-4990-b2c8-7adfcfe961ca.md) | [raw](592705ed-b789-4990-b2c8-7adfcfe961ca.json.gz) | Complete; acceptance not evaluated |
| PGlite timeline, Product update typical | [report](80832901-6a6f-46ad-add3-1511bbae44a5.md) | [raw](80832901-6a6f-46ad-add3-1511bbae44a5.json.gz) | Complete; acceptance not evaluated |
| Ordinary-role PostgreSQL database, Payload create small | [report](1f9adf1b-76e0-402c-9a44-c1f3e865bf94.md) | [raw](1f9adf1b-76e0-402c-9a44-c1f3e865bf94.json.gz) | Complete; acceptance not evaluated |
| Ordinary-role PostgreSQL quiet native/Flarex Payload pair | [report](9e899d4f-1209-49d3-8ef2-2f7b89508af4.md) | [raw](9e899d4f-1209-49d3-8ef2-2f7b89508af4.json.gz) | Complete execution; acceptance failed |

Each diagnostic uses zero warmups, a separate fresh calibration, and one
instrumented request. Fixture preparation, verification and command cleanup
remain outside request timers. Server calibration shares its declared
diagnostic settings. Sources and durable settings remained stable within each
retained run; cleanup completed. The runs preceded the scoped commit and retain
their own source digests. They are separate requests, graphs and instrumentation
profiles, not repeated measurements of one latency distribution.

The CPU exports retain sanitized stacks and allocation samples:

- PGlite: [CPU profile](10e61a12-d9a2-400c-87b1-13d4f722fc2c-flarex-1.cpuprofile.gz) and [allocation profile](10e61a12-d9a2-400c-87b1-13d4f722fc2c-flarex-1.allocation.json.gz).
- PostgreSQL: [CPU profile](d72eeb45-935f-4782-8050-abc2246653e0-flarex-1.cpuprofile.gz) and [allocation profile](d72eeb45-935f-4782-8050-abc2246653e0-flarex-1.allocation.json.gz).

Decompress a `.cpuprofile` before loading it into a compatible CPU profiler.
These are Node host observations. PostgreSQL's CPU request retains process and
thread CPU counters, sampled stacks, GC intervals, event-loop utilization and
memory endpoints. Its 112,262,560-byte allocation estimate covers the entire
profiler window; allocation samples have no timestamps. It cannot be assigned
exactly to request phases. Root/CPU alignment retains a 37.853 ms offset
uncertainty and boundary-ambiguous samples. Endpoint memory is neither total
allocation nor peak memory. These values include instrumentation and do not
establish quiet request cost or exact business causality.

The server request retains 40 client driver exchanges, all linked to an actual
operation and backend PID, 43 top-level statement-statistic calls and 664 nested
calls. It retains 701 sanitized actual plans in the observed log window.
Client exchanges, server statement calls and plans describe different levels of
work. Top-level execution elapsed is 117.496 ms and nested elapsed is 85.649 ms;
they overlap and must not be added. These are elapsed observations, not CPU.
The complete instrumented call is 446.913 ms. Driver-await union is 266.845 ms.
Those observations do not support subtracting server elapsed to invent transport
or runtime cost.

The server sample observed ClientRead and one WalWrite wait. Its four
single-candidate PID/time matches retain candidate status; short statements and
polling gaps remain unmatched. Samples do not establish exact wait durations or
absence of other waits. Separately, the real PostgreSQL server-resource test
held a conflicting row lock and verified observed Lock waits and blockers before
release. Plan output excludes SQL text, expressions, names and parameters;
the private original PostgreSQL log is not archived. Timing-off triggers retain
call counts with `timeMs: null` when PostgreSQL omits timing. Log flush
completeness and exclusive request ownership remain unproven.

The fresh quiet pair retains native 115.049 ms, Flarex 292.019 ms and excess
176.970 ms. Both complete calls verified committed business results without
collectors. One cold pair with no warmups fails sampling and latency gates;
it proves comparison assembly, not a stable baseline or acceptance. Native
framework calls commit independently; mixed Application references use a SQL
surrogate. They do not reproduce Flarex's atomic publication, OCC, revision
history or durable outcome guarantees.

The final deterministic SDK/connected-owner suite passed 239 tests, with 14
explicitly gated skips. Actual CPU, server, Product, Payload and fresh comparison
proofs ran separately. The expanded ordinary-role PostgreSQL flow lane and all
five original smoke graphs also passed. Executor/performance, persistence and
Medusa typechecks, scoped lint, source guards and both final reviews passed.
These establish the selected private SDK and fixture contracts. They do not
establish production/Cloudflare profiling, all possible bottlenecks, extended
native mappings or reduced core overhead. Runtime optimization remains paused.

## Integrity

[integrity.json](integrity.json) records each original/restored file's SHA-256,
original byte size and retained byte size. Gzip restoration and Markdown copies
were checked byte for byte. Hashes identify restored content rather than gzip
envelopes. Raw events, incomplete attribution, overlap and uncertainty remain
available alongside the summaries.
