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

The owner subsequently approved integration in the main checkout. The other
session's Product scale work is committed in `747e1c4c`; the installation changes
preserve its resource-policy wiring and do not modify Product model behavior.

## Prepared runtime integration

Commerce host construction now prepares one immutable installation description
in a separate repeatable-read transaction. Full existing restoration must pass
before the same snapshot supplies the dependency coordinates, expected evidence
fingerprints and pure profile/layout/readiness data. Publication of the opaque
token happens only after preparation settles. Schema installation remains a
deployment operation; host preparation performs no installation or DDL. Hosts
must be reused across commands to amortize preparation.

The accepting business transaction still obtains scope authority and the scope
clock, then locks the availability head `FOR SHARE`. It checks all head columns
against preparation, and runs one closed, typed metadata query for the evidence
below. Actual canonical bytes are hashed in PostgreSQL before JSON conversion;
the query does not compare only stored hashes or send expected canonical bytes
back to PostgreSQL. Each row includes every declared column; sorted fixed-length
row fingerprints preserve section membership and multiplicity. SHA-256 collision
resistance is an explicit assumption. No certificate or asynchronous audit
replaces the current evidence reads.

| Existing condition | Preparation | Fresh command evidence |
| --- | --- | --- |
| Target/database capability and binding reference | Authenticate and own a bounded reference | Same authenticated target token and exact reference; host retains its existing database/authority checks |
| Namespace and collision projections | Existing repository restoration | All columns of pinned namespace and collision roots |
| Installation identity, canonical bytes and references | Existing canonical/metadata restoration | All installation root columns |
| Plan canonical/layout semantics | Existing plan verifier | All selected plan bytes/projections; all plan-step and dependency sidecars |
| Physical naming ledger | Existing assignment restoration | All assignment columns selected by database/schema/spelling, including actual bytes |
| Admission profile, predecessor and assignment coverage | Existing admission restoration | All admission/predecessor-plan roots and admission-assignment sidecars |
| Attempt start and predecessor chain | Existing attempt restoration | Every traversed attempt root, including historical lease projections |
| Terminal and successful receipts | Existing terminal/receipt restoration | Terminal roots, all receipts for their attempts and receipt-dependency sidecars |
| Fresh-plan absence of additive base | Existing base reader | Complete base-row section, including previously absent rows |
| Readiness and availability history | Existing restoration and chain limits | Readiness roots and complete traversed history roots |
| Current availability | Existing ready/reference check under head lock | Fresh head fingerprint under the lock held through business settlement |
| Application activation, binding head/profile/coverage and initialization seed | No retained authority | Existing current transaction checks, unchanged |
| Publication, OCC, replay, rollback and events | No new owner | Existing command and committer behavior, unchanged |

This inventory supports the existing fresh Commerce installation contract.
Preparation rejects plan wire version 2: additive plans additionally inspect
collision-wide admission/attempt budgets, and need their own acceptance inventory
and parity proof. Standalone cross-domain composition explicitly retains its cold
reader. A prepared Commerce host never falls back after a comparison failure.

The state is host-owned through a weak registry: at most one bounded description
per host, no eviction timer, shared mutable cache, acquired connection, transaction,
fiber or restored repository graph. Preparation is bounded by 64 graph roots,
4,096 names, 32,768 rows per evidence section, 8 MiB of retained pure data, a
15-second body timeout, 5-second statement timeout and 1-second lock timeout.
The existing transaction bridge waits for settlement on interruption; no token
is published on interrupted or failed construction. Independent constructions
do not share state. Availability changes require a newly prepared host/reference;
there is no TTL-based freshness or automatic blessing of changed evidence.

## Integrated PostgreSQL measurement

The fixed-source Product benchmark based on `747e1c4c` executed 240 timed commands
per variant across simple/nested create, title update and delete, with 12 warmups
per variant. Its boundary is the reused host's complete `run`: adapter work,
authority/admission, DML, publication, PostgreSQL settlement and awaited local
events. HTTP, schema installation and host construction are excluded. The ordinary
PostgreSQL 18.3 benchmark role retained `fsync` and `synchronous_commit` enabled.

| Measurement | Previous runtime | Prepared runtime |
| --- | ---: | ---: |
| Complete command median | 606.2 ms | 205.3 ms |
| Observed complete-command p95 | 1,670.2 ms | 932.0 ms |
| Observed complete-command p99 | 11,084.5 ms | 3,597.3 ms |
| Installation acceptance median | 396.3 ms | 14.9 ms |
| Installation acceptance observed p99 | 488.8 ms | 21.8 ms |
| Installation SQL per command | 18 | 2 |
| Mean total SQL per command | 216.7 | 200.7 |
| Failed timed commands | 1 | 0 |

Prepared host construction measured 440.2 ms median across three observations.
This is startup preparation, not DDL or a per-command cost for a reused host.
Its installation check sends 12,262 parameter bytes plus 23,188 SQL-text bytes per
command and returns 1,145 JSON-serialized result bytes, excluding protocol framing.
The accepting query no longer sends the prototype's 442,580-byte parameter payload.

The 66% observed complete-command median reduction does **not** establish the tail
objective or a clean all-success comparison. The baseline hit statement timeout
during idempotency publication and correctly failed the harness's zero-failure
assertion. The prepared variant passed all command/publication/fact/cleanup checks.
Independent analysis of the captured baseline counts still matched one committed
outcome and outbox wake per successful command. No slow or failed samples were
removed from the latency population.

The prepared run includes a 2,224.8 ms business COMMIT and slow auxiliary COMMITs.
Contemporaneous PostgreSQL checkpoints reported 43.0 and 25.2 seconds of total
sync time, with individual file syncs reaching 2.3 seconds. This correlates the
tail with storage/settlement stalls but does not identify the precise device or
OS cause. Durability was not weakened. The per-command remainder after subtracting
its installation span still has 190.5 ms median, about 199 other SQL calls and six
auxiliary transactions. Their authority/composition owner remains the next
separate preflight; this slice changes none of those lifetimes.

Runs were sequential, not interleaved, and measured one active command at a time.
These local observations do not establish production p99, same-scope contention
or independent-scope throughput. The report, source/load receipts, raw results,
initial harness failures and checkpoint evidence are in the external benchmark
directory as `runtime-*` and `postgres.log`.

Validation: persistence TypeScript checking, `lint:core`, `lint:diff` and
`git diff --check` pass. Eleven distinct regression cases pass across the
installation-runtime, installation-acceptance, binding, admitted-write and
native Currency/composite suites. Native tests prove concurrent preparations,
interrupted preparation settlement/connection release, subsequent successful
construction, and head-lock retention through accepting transaction settlement.
The physical-name corruption fixture initially reused a PostgreSQL Buffer view;
changing that fixture to an owned byte copy restored its intended negative-test
sequence, and all three native runtime tests passed on rerun. PGlite and all
other regression cases passed; this was a test-fixture correction.

The owner subsequently requested committing this integration together with the
command-admission redesign on main. Main-thread self-review covered the typed
evidence inventory, graph/reference closure, snapshot and lock lifetimes, foreign
driver bytes, error channels and resource bounds. Independent reviewer agents
were not run in this side conversation; the earlier commit's explicit reviewer
waiver is not represented as a new review receipt. The direct owner instruction
to commit is recorded separately from independent review, which did not occur.
