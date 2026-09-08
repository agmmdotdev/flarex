# Installation runtime acceptance redesign

Status: the owner approved the recommended prepared-evidence implementation
with fresh comparison after rejecting the remaining command latency. This
approval preserves the current integrity contract; it does not approve the
larger certificate alternative or changes to transaction/publication authority.
The first diagnostic prototype is complete; runtime integration remains pending.
The existing bounded correction remains described
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

## Prototype result and next implementation boundary

The frozen-source PostgreSQL prototype compared the same successful Product
reader's 18 SQL projections in a single statement after acquiring the existing
availability share lock. Preparation first ran full restoration and captured
expected representations in the same repeatable-read snapshot. No restored
authority graph was retained or supplied to a command.

| Verification transaction | Timed samples | Median | Observed p95 |
| --- | ---: | ---: | ---: |
| Current full reconstruction | 46 | 329.4 ms | 361.8 ms |
| Exact fresh row comparison | 156 | 38.8 ms | 42.4 ms |
| Freshly computed row fingerprints | 156 | 37.0 ms | 40.2 ms |

All modes include acquisition, BEGIN and COMMIT, but exclude application/scope
admission, Product work and publication. These are verification measurements,
not a new complete-command result. The fingerprint experiment computes SHA-256
over actual current row representations, never merely compares stored digest
columns. It adds a cryptographic collision assumption to equality and is not
enabled in runtime code. It is distinct from the certificate alternative above:
every dependency is still read each time.

The exact variant sends 2,165,681 native pg-encoded parameter bytes per
comparison statement; the fingerprint variant sends 442,580. Those counts
exclude SQL text and protocol framing. Thus neither diagnostic query shape is
ready for runtime adoption. Typed owner-provided projections must eliminate
redundant representations and large repeated expected parameters before
integration. A local database masks the remote transport cost.

Both variants reject changed ancestor projections, changed installation bytes
with unchanged digest, missing and extra dependency sidecars, and a committed
availability withdrawal through the actual transition repository. Those ten
checks passed. The prototype does not establish concurrent preparation,
bounded host lifetime, all installation profiles, a complete corruption matrix,
or command correctness after integration.

The comparison inventory includes namespace and collision roots; installation,
terminal, attempt, admission and plan roots; physical name assignments; plan
step/dependency comparison; absent additive-base evidence; admission assignment
sidecars; receipt roots and dependencies; history and readiness roots; and the
locked head. Production implementation must use a closed, typed inventory with
each repository owner, not the prototype's driver interception or SQL placeholder
rewriting. Pure canonical validation belongs to preparation; all stored evidence
covered by it needs fresh comparison; scope, binding and head decisions remain
fresh transaction operations. The accepting result must contain the required
data without impersonating a restored repository capability.

Re-analysis of the prior 48 complete commands, subtracting verification within
each command before aggregating, gives 158.4 ms median and 187.6 ms mean outside
installation verification. That remainder contains 198.7 SQL calls and six
auxiliary transactions per command. Current commerce obtains located authority
and an active selection before the business transaction; active selection itself
resolves authority and runs hint/readiness/active-state work. The accepting
transaction then validates application binding basis. This is evidence for a
separate authority/composition-owner preflight, not permission to delete guards
or combine transactions.

Source files changed in the shared checkout during investigation. A preliminary
run correctly failed its source-stability assertion. The successful run instead
used a verified frozen source snapshot via Vite's preload hook, including load
receipts for the measured repositories and host. No worktree or source reversion
was used. The raw runs, earlier harness failures, source snapshot, statement
plans, transport measurements and report are retained in the external benchmark
directory under `prepared-*` and `command-remainder-*` names.

Concurrent main-session changes currently own commerce host/profile and Product
runtime files. This side left them untouched. Host integration ownership must be
resolved before editing those overlapping files; the approved verifier design
does not authorize overwriting another session's work.
