# Installation runtime acceptance redesign

Status: the owner approved the recommended prepared-evidence implementation
with fresh comparison after rejecting the remaining command latency. This
approval preserves the current integrity contract; it does not approve the
larger certificate alternative or changes to transaction/publication authority.
Implementation remains pending. The existing bounded correction remains described
in [installation acceptance performance](./installation-acceptance-performance.md).

## Problem and scope

The measured normal Product command still takes 512.9 ms median, with 354.6 ms
spent in installation acceptance. The diagnostic longer-lived pure-byte cache
reduces those medians to 237.7 ms and 89.1 ms, respectively. Installation setup
is excluded. These are small local PostgreSQL samples, not production percentiles.
The after-change normal run reports 359.7 ms mean acceptance but only 17.2 ms
mean summed acceptance SQL round trips. Removing duplicate traversals did not
remove the cost of decoding and reconstructing a historical evidence graph.

The balanced command mix also still issues 216.7 SQL calls on average, of which
18 belong to installation acceptance. Optimizing acceptance alone cannot resolve
the remaining command path. Do not derive its latency by subtracting medians;
measure the phases of each command and classify its actual SQL calls.

The installation persistence owner owns evidence preparation and acceptance.
Binding owns profile coverage and current binding checks. Host composition owns
runtime lifetime. Physical session, transaction authority and publication owners
retain their contracts; evidence from this benchmark is not authorization to
remove their guards or combine their transactions.

## Recommended first design: prepared evidence with fresh comparison

Separate expensive evidence validation from current transaction acceptance.

1. Preparation performs the existing complete bounded restoration and creates
   a private, detached description of validated installation identity, admission
   profile, physical layout, readiness capabilities, and the exact stored
   evidence closure used to establish those values. Include canonical bytes,
   every checked projection, dependency membership, ordering and multiplicity.
   A description contains data only, never restored repository authority,
   transaction handles, mutable head verdicts, or permission to execute DML.
2. A bounded host-owned store retains that description for reuse. Partition
   entries by database/target identity, full natural installation identity and
   validation policy; include the binding/profile contract in any retained
   profile-coverage result. Define byte and entry ceilings, eviction, concurrent
   preparation ownership, failure/cancellation cleanup and host shutdown before
   implementation. Reopening a runtime can require preparation again; this
   performs validation, not schema installation. A cache miss is explicit
   preparation and must be measured separately from ready-runtime requests.
3. Each accepting transaction retains existing scope/application protection,
   freshly reads and locks its availability head, and verifies exact binding,
   status, sequence, history/readiness commitments and target identity. It
   compares the current immutable evidence closure with the prepared expected
   closure using bounded set-oriented persistence queries. Success must prove
   both directions of membership, every validated column and exact bytes;
   comparing stored digests or row counts alone is insufficient. Missing, extra,
   duplicate, reordered or changed evidence must still fail before mutation.
4. Successful comparison allows the transaction to consume prepared data
   through a new narrow accepting result. Do not forge or register a cached
   graph as a freshly restored repository object. Keep full restoration for
   preparation, migration and repository inspection. Head or binding changes
   invalidate the relevant prepared selection; preparation must not silently
   authorize a new binding or turn corruption into success.

This approach removes repeated JavaScript graph reconstruction and large result
transport while preserving fresh evidence checking. It does not promise work
independent of graph size: exact comparison still visits evidence in PostgreSQL
and may send substantial expected data. Prototype query count, request bytes,
server work and latency before committing to this design. Validate coherent
comparison and lock ordering under the existing isolation contract; do not
assume separate SELECTs automatically share one snapshot.

Preparation should happen before holding the application's command locks where
the existing owner permits it. The accepting transaction must independently
establish freshness afterward, so preparation itself grants no authority.

## Larger alternative: immutable installation certificate

A compact accepted installation certificate plus fresh head/binding checks can
make steady-state acceptance independent of migration-history size. That requires
an explicit new integrity contract. Current artifact policy defines immutability
through repository write policy and fail-closed reads, and requires detection of
raw maintenance corruption. Current migration capabilities are software
capabilities; database role enforcement has a separate production gate.

Consequently, unchanged head or installation digest cannot prove that an
unread ancestor or sidecar has not changed. A certificate design must define
enforced write ownership across the complete dependency closure, how every
supported repair/replacement changes an observed generation, and how privileged
bypass or corruption is handled. Moving detection to a later audit changes the
present request contract and requires a separate owner decision. A TTL, runtime
restart policy, or cached successful restoration cannot substitute for this.

References: [artifact integrity policy](./preflight/02-artifact-repository-and-ddl.md),
[migration role boundary](./preflight/09-relational-installation-and-migration-coordination.md),
and [current verification lifetimes](./preflight/27-product-installation-reconstruction-cost.md).

## Implementation gates and remaining command cost

- Inventory every current restoration check and map it to preparation, fresh
  comparison or fresh authority. Reject a design with an unmapped condition.
- Prove changed bytes with unchanged digests, altered ancestor projections,
  missing/extra sidecars, cross-target reuse and changed bindings remain rejected
  after a successful prior command. Test concurrent preparation, eviction,
  cancellation and shutdown without retaining transaction authority.
- Prove availability withdrawal/replacement and migration races on real
  PostgreSQL, including lock lifetime through settlement and unchanged rollback,
  replay and publication behavior.
- Benchmark cold preparation and ready-runtime commands separately for simple
  and nested Product create/update/delete. Capture paired per-command phases,
  SQL ownership/counts, input/output bytes, failures and same-scope versus
  independent-scope concurrency. Increase samples before reporting tail latency.
- Audit the remaining roughly 199 SQL calls per command by their actual owner
  and purpose. Identify repeated work within one physical transaction and the
  locks that could justify reuse. Any authority-lifetime or transaction change
  needs its own bounded preflight; do not simply remove guard calls.
- Set a numeric end-to-end budget before implementation acceptance. Treat
  installation acceptance as a small portion of it. No sub-100-ms or other
  latency result is established by the current evidence.

The recommended first prototype preserves the existing integrity contract.
If exact comparison remains too costly, use its measurements to decide whether
to adopt the explicitly larger certificate design. Extending the experimental
byte cache alone is not completion of this redesign.
