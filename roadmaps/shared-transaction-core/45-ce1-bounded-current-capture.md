# Bounded Current Row Capture

Status: implemented under standing core approval, with cardinality-aware point
selection; broader performance acceptance remains open.

## Outcome And Owner

Replace the separate size probe and document fetch in the shared current-row
reader with one SQL capture. Keep its scope-clock validation first. The existing
CMS document owner remains the caller; no adapter-local cache or alternate read
implementation is introduced. This reduces round trips while the request owns
scope exclusion without changing the coordinated writer/sequence protocol.

An eight-row CMS insert performs eight absence checks through this reader.
Each previously paid a clock read, a bounded size query and a document query even
when no row existed. The capture removes one statement per read. Complete active
requests retain the same publication and replay assertions; fewer statements do
not establish lower latency or greater capacity.

## Capture Contract

For batch and scan reads, build a bounded pointer/size CTE using the exact scoped selection,
row ordering and identity limit plus one. Aggregate only that bounded set. Gate
the join returning row bodies on all identity, per-document and aggregate-byte
limits. An over-budget capture returns only its negative verdict with null row
fields; no body bytes may cross the driver boundary. An empty valid selection
returns an empty result. Preserve tombstones, missing-revision and future-pointer
refusal, canonical evidence decoding and all identity/snapshot validation.

The [point capture refinement](./46-ce1-point-capture-plan.md) uses exact
primary-key cardinality to avoid aggregate work for explicit point reads. SQL
CASE withholds an over-budget point body; both shapes share the same validation
and decoding contract.

Both size and body observations use one PostgreSQL statement snapshot. Do not
apply a window aggregate to the whole table before LIMIT, read oversized bodies
and check them in JavaScript, or omit the fresh scope-clock check. A prepared
snapshot number alone does not establish current authority.

## Breaks And Cleanup

Replace the two private query-observation names with one capture observation;
migrate the existing CMS bounds and Payload population/relationship observations,
preserving batch selection and request-cache coverage. Public arguments/results, stored rows,
indexes, transaction ownership and deadlines are unchanged. Remove both old
query paths and their cross-statement row-count comparison. The single-statement
capture replaces that comparison's consistency purpose; there is no compatibility
reader to retain or durable data to migrate.

## Performance Disposition

Retain the single-statement budget/body contract and its bounded transport proof.
The aggregate plan adds planning and aggregate work, making it a poor default
for exact point probes. The point refinement removes that unnecessary work using
schema-enforced cardinality and improves the measured local point-heavy request
lane. Keep the set-wide plan for batch/scan budgets. Neither fewer statements nor
these local samples establish general latency or remote-network savings.
Large-catalog plans and connected capacity remain open under CE0/CE1; current
scope exclusion and all capture limits remain unchanged.

## Completion Gates

Use both PGlite and ordinary-role PostgreSQL to cover point/batch/scan results,
empty and zero-budget sets, tombstones, scope/table confinement, row limits,
per-body and aggregate overflow, dangling/future pointers and malformed canonical
data. Preserve current CMS command, publication, rollback and replay witnesses.
Verify PostgreSQL transport bytes stay bounded when large stored bodies are
rejected; syntax inspection alone is insufficient for that claim.

Compare the unchanged active CMS measurement lane on one/eight/thirty-two rows,
keeping failed outcomes and observation overhead visible. Record SQL counts and
local timing limits without claiming a complete reference or production capacity.
Run affected typechecks, lint, both reviews, cleanup and one scoped commit.
