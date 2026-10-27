# Initial connected measurement

Status: connected latency/CPU/SQL cohorts are recorded in [RESULTS.md](./RESULTS.md).
They miss the provisional latency goals. The corrected batch/contention cohort
and initial keep/change/reject assessment are complete. Its local concurrency
target passes; complete-request performance acceptance does not. The active lane
is unmeasured; its last preparation failed as retained
in `validation/payload-create-failure.json`.

The [combined read-guard iteration](./READ-OBSERVATIONS.md) uses the same workload,
warmup and sampling protocol. Set `FLAREX_EXPERIMENT_MEASURE_LABEL=combined-read`
to retain separate `validation/combined-read-{latency,cpu,sql}.json` reports.
The default label remains `connected`; the previous cohort is preserved.
That iteration passed all correctness/source/resource checks and reduced
exchanges, but did not show a latency or CPU improvement. Its results and
cross-cohort attribution limits are recorded in the linked note.

The [observation-cost slice](./OBSERVATION-COSTS.md) adds a separate `profile`
diagnostic mode with V8 stacks, resource-only driver observation and duration-only
server logging. Its observed times do not replace quiet latency/CPU campaigns.

The [bounded observation composition](./COMBINED-OBSERVATIONS.md) uses this same
harness and protocol, replaying the prior seven runtime files only for its
control, then restoring the current implementation byte-for-byte. Final control
labels are `operation-control-sql`, `operation-control-retry-{latency,cpu}` and
`operation-control-scaling`; after labels are `operation-after-{sql,latency,cpu}`
and `operation-after-scaling`. The first control latency preparation timeout is
retained separately without acceptance credit. No source, durability, timeout,
native workload or output assertion is loosened to obtain a passing campaign.

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

The scaling cohort uses five warmups and five measured commands for each
insert/overlay/indexed-edit/nonindexed-edit cell at sizes 1/16/64. Overlay changes
index membership, changes a unique name, deletes pending rows and queries the
pending numeric range in the same authored SDK function. Each cell has a later,
separate SQL observation; observer time is excluded from the latency samples.
Compare a selective one-row command before and after adding 64 unrelated
definitions and 256 unrelated retained rows through the real accepting owner.

Contention uses 128 independent one-row authored mutations per cell at
concurrency 1/4/8, first within one scope and then spread over that many scopes.
Record the shared pool's actual maximum, every request outcome, retry count,
throughput and P95. Verify all successful committed documents afterward. These
bounded cells are diagnostic loads, not a production capacity/SLO proof.
Automatic retries are disabled; reported attempt/retry counts describe successful
results, while refusals may occur before an attempt. The ordinary-field edit
changes `note`, which has neither unique nor query indexes; unique-name changes
remain in the overlay workload, separately from the indexed priority edit.

The [validation protocol](./VALIDATION.md) remains authoritative. Initial results
can justify continuing or changing this bounded candidate, not production use,
general framework support or all-workload performance acceptance.
