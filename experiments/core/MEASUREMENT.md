# Initial connected measurement

Status: connected latency/CPU/SQL cohorts are recorded in [RESULTS.md](./RESULTS.md).
They miss the provisional latency goals. Batch/contention diagnostics remain
pending. The active lane is unmeasured; its last preparation failed as retained
in `validation/payload-create-failure.json`.

The explicit two-lane experiment measures these complete requests:

| Workload | Candidate | Reference |
| --- | --- | --- |
| Payload CRUD | Native create/update/read plus deletion of another existing document and two actual preferences; independent commands | Same native Local API calls using the genuine Postgres adapter |
| Product | Native scalar title/handle/status update, retrieve and list-by-handle in one command | Same genuine native Product module methods, independently committed |
| Mixed | Actual authored Application insert, Product sequence and Payload CRUD/cleanup in one atomic command | Same authored Application function on a separate candidate Application host, then genuine native Product/Payload methods, independently committed |

The mixed reference explicitly uses the candidate's standalone Application owner:
native frameworks have no equivalent Application SDK/OCC implementation. It is a
business-cost reference, not a native atomic baseline. Framework history,
dependencies, durable outcomes and cross-framework atomicity differ. Do not claim
a speedup against the active core or equivalent mixed semantics from this run.
Product is relation-free; the five existing populated business graphs remain open.

Installations, definitions, native users, Product rows, old documents and
preferences are prepared before each request. Complete outputs and committed
readback are checked afterward. Every returned key is compared, with independently
generated IDs and validated wall-clock timestamps normalized only where necessary.
Native business work is never reimplemented in the harness.

Use five warmups and thirty alternating pairs per workload for quiet latency and
client CPU. SQL mode uses two diagnostic pairs after five warmups; its elapsed
times include observation and are not latency acceptance evidence. Run these
modes in separate fresh processes. Record actual
ordinary serving roles, durability settings, complete samples, source hashes and
failures. Reject changed-source cohorts. Counter quantization, process memory,
decoded JSON bytes, client-observed transaction spans and unavailable server
metrics must retain their actual meaning.

After complete requests, diagnose pending batches of 1/16/64 rows, indexed versus
nonindexed edits and selective queries, unrelated definitions/retained rows, and
concurrency 1/4/8 across one versus distinct scopes. Predeclare a diagnostic target
of 100 successful independent 1-row Application mutations/second with P95 below
100 ms at concurrency 4 and zero exhausted attempts. This target guides the first
local contention assessment; it is not a product SLO or inherited acceptance gate.
Report conflicts/retries, pool limits and unavailable exact server lock hold/wait.

The [validation protocol](./VALIDATION.md) remains authoritative. Initial results
can justify continuing or changing this bounded candidate, not production use,
general framework support or all-workload performance acceptance.
