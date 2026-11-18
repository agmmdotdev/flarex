# Admission and target metadata protection

Status: **delivered; measured stage cost gate passed; final mixed latency goals unmet.**
This connected slice extends immutable target protection
under the existing full restricted-login and installation attestation and
privileged-quiescence requirement. No new backend certificate, maintenance
authority or generation-only guard is accepted. [Slice 14](./14-execution-redesign-roadmap.md)
owns the sequence; 16 is the next preflight gate and 17 remains a dependent draft.

## Connected outcome and accepted direction

Prepare canonical immutable target Application/framework binding evidence in an
owned lifetime and reuse it only inside the exact accepting transaction that
registers its final protected-epoch guard. Connect existing Application, Product,
selected Payload Local API and finite workflow consumers through persistence
owners. Keep mutable admission, pinned heads, source authority, build/coverage and
physical catalog checks fresh. Postgres remains the only settlement authority.

The [accepted prepared-execution integrity contract](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
is explicitly extended for this scope. Canonical target body/closure authentication
and repeated scope-clock probes are attributable work in the current
988 / 1,252 / 1,979 / 354 dispatch graphs. The nearest proof is reduced repeated
work on those same graphs while preserving exact-root, pending-read, journal,
OCC, rollback, recovery and publication behavior.

Use the existing `preparedMetadataEpoch` issuer, private WeakMap identity and
complete `readIdentity` attestation at capture and tail. Actual graphs use the
legacy Application readiness issuer's authenticated epoch as their before
anchor. First full activation, legacy revision-schema projection and binding
activation/candidate/complete-lane reads each authenticate the current epoch
against that same anchor after canonical decoding and before retention. The
expected generation is never rebased. Prior/interleaved same-transaction metadata
writes refuse retention; rollback cannot promote their uncommitted structure.
Later writers remain refused by the final tail. Lazy snapshots store immutable
structure only, including binding activation's strong-reference projection;
they never store a live readiness verdict. Canonical authentication still precedes
reuse. Digest equality, readonly values and an unchanged readiness root do not
establish protection. Application preparation copies its nominal issuer's exact
scope, revision, activation sequence and head/activation byte pins. A different
fresh head receives the existing full coherent read and cannot fill this
selection; its owning basis check preserves concurrent-head failure order.
Binding retains one activation/candidate snapshot and uses it only when the
fresh head selects the same scope, generation, sequence and activation/candidate
identity. A different head takes the same full canonical reader as an ordinary
preparation miss, without replacing or recharging the retained snapshot. A
matching identity still checks the complete strong-reference projection and
refuses malformed projection; it cannot turn corruption into a miss. These
rules prevent rolled-back live-head movement from poisoning later valid reads.
Reuse the issued scope-clock observation only within its
same exact accepting transaction: the kernel's SHARE/NO KEY UPDATE lock conflicts
with the revocation writer's FOR UPDATE lock. A different transaction repeats
fresh checks. The clock owner retains an owned Date and returns detached records;
same-transaction revocation, publication and retained-floor mutation owners clear
the issued observation before changing clock fields. Every callback, failure and
interruption exit revokes it. No caller-created clock evidence is admitted.

Reject a generic certificate/cache service, module-global cache, compact
generation-only guard and new backend or privileged maintenance controller.
Their trust/reconnect/deployment contracts are different work. Existing privileged
quiescence remains an operational requirement, not an enforced drain barrier.

## Exact protected inventory and writers

One target-schema epoch covers **23 tables**. Retain these ten legacy watched
tables for their actual legacy Application readiness/projection consumers:

- `fx_system_application_candidate_v1`
- `fx_system_application_analysis_v1`
- `fx_system_application_revision_v2`
- `fx_system_application_publication_v1`
- `fx_system_application_function_v1`
- `fx_system_application_task_catalog_v1`
- `fx_system_application_task_definition_v1`
- `fx_system_application_revision_schema_v1`
- `fx_system_application_readiness_v1`
- `fx_system_application_readiness_function_v1`

Add these thirteen current immutable target tables:

| Added table | Authenticated content and owner |
| --- | --- |
| `fx_system_application_publication` | Canonical publication bytes, digests, revision and complete function/relation closure; Application publication/readiness |
| `fx_system_application_function` | Canonical bytes, digest, revision and complete membership; Application publication |
| `fx_system_application_task_catalog` | Catalog bytes and closed task membership; Application task bindings |
| `fx_system_application_task_definition` | Task bytes and identity; Application task bindings |
| `fx_system_application_revision_schema` | Schema bytes, hashes and correlation; Application schema projection |
| `fx_system_application_readiness` | Immutable root/body/hash correlation; Application readiness |
| `fx_system_application_readiness_relation` | Complete relation sidecars, field and membership closure; relation readiness |
| `fx_system_application_readiness_function` | Complete function sidecars and membership closure; Application readiness |
| `fx_system_application_activation` | Immutable activation and source correlation; Application activation |
| `fx_system_application_write_ownership` | Complete owned-table membership and source correlation; Application ownership |
| `fx_system_data_binding_candidate` | Canonical candidate/manifest bytes, hashes and source identity; framework binding repository |
| `fx_system_data_binding_physical_lane` | Complete lane membership, identity and source correlation; framework binding repository |
| `fx_system_data_binding_activation` | Immutable activation and binding correlation; framework binding activation |

Every column is protected by `BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
FOR EACH STATEMENT` invalidation in the writer transaction. This covers zero-row
and no-op statements, direct SQL, OLD/NEW key movements, missing/extra members
and every authenticated field without a fragile column list. Rollback rolls back
the bump. Canonical publishers, binding repositories, direct DML, fixtures,
migrations and authorized repairs use those same triggers. Adapters cannot
bypass or reproduce this policy.

Live Application/framework heads, scope clocks, revocation/session/lease/claim/
journal state, mutable lifecycle/build/coverage frontiers and application data
stay outside immutable protection and freshly checked. Physical DDL/index facts,
including exact GIN method/columns/operator classes, validity/readiness and
predicates, remain fresh. Control canonical bodies, ordered definitions and
unique closed-set preparation retain their separately owned current contracts.
Separate control and target databases have no atomic joint generation.

## Attestation, threats and lifetime

Keep the full authenticated `session_user = current_user` proof: restricted LOGIN
attributes, role membership, replication setting/parameter rights, database/schema
CREATE and ownership, epoch privileges, installation function definitions/security/
ownership and exact trigger shape on all 23 tables. Captured proof retains
actual database, namespace OID, incarnation, login and generation. Pooled reuse
and reconnect pass the same full checks; pool identity is not attestation.

Ordinary nonowner DML atomically invalidates. Runtime cannot write/TRUNCATE the
epoch, disable/replace triggers, execute the invalidator, become the owner or
switch replication mode. The accepting transaction's last metadata acquisition
uses the existing `FOR SHARE NOWAIT` guard: change fails with `changed`, contention
with `busy`, and the whole transaction rolls back. Nonblocking acquisition avoids
a clock/row versus epoch lock cycle. Effect failures retain the persistence
owner's typed contract and existing narrow driver resource-failure mapping.

Owner/superuser repair and structural DDL must quiesce protected preparation.
Full runtime attestation cannot certify privileged disable/edit/restore without
invalidation and does not implement a maintenance barrier. Authorized repair or
restore must invalidate old preparation, change generation/installation as
appropriate, reauthenticate canonical data and reattest before resume. Hosted
maintenance enforcement remains separately gated.

## Replacement, callers and durable cutover

Extend the existing internal issuer/evidence rather than add a public API. Guarded
reuse belongs to the exact-running attempt kernel and its source/journal/
publication consumers. Independent standalone and durable-operation callers
without that exact scope retain complete proof; they are actual execution
profiles, not fallback engines. Legacy Application readiness still consumes the
ten legacy tables; removal requires migration of those callers in their owning
slice. No new wrapper or dual export is justified.

Replace repeated immutable target reads at the shared Application active-head
activation reader, legacy revision-schema projection reader and framework binding
activation/candidate/lane reader. Actual Currency/Product/Payload/workflow fixtures
use `makeApplicationReadinessRepository`, not the current relation Fold. Current
`PreparedApplicationRelationActiveRead`/Fold callers retain their full proof as
an actual obligation; watched-table extension alone does not migrate them. Migrate
connected callers and delete displaced target rereads in this same slice,
preserving fresh source/head correlation and distinct full/selected readiness.
Kernel guard registration/flush and transaction-exit revocation remain the owner.
Immutable structural preparation spans transactions only inside its owned
preparation lifetime. The retained mixed fixture uses request/series-owned
readiness selections and source admissions; their canonical readers bound each
retained payload, and they do not borrow a retained-host allocation. When
constructed by a retained host, lazy snapshots capture that actual lease's byte
allocation, charge once in a synchronous check/charge/install step, and reject
new fills after close. Host disposal releases the owned preparation closure and
allocation. Live checked clock/admission evidence and guard registration expire
at exact transaction exit; each later boundary registers its own final guard.

Additive migration `0120` installs thirteen triggers and advances the existing
generation once, invalidating process-local preparations. It preserves canonical
data, journal attempts, retained outcomes, schema identities and durable protocol
formats. No new durable encoding or data reset is required. Quiesce preparation
during installation. This private profile is not activated on a named durable
environment. Disposable administrative fixture reset creates a new incarnation,
reseeds before schema reuse and rejects old preparation. Preserve unchanged-digest
body/closure tamper witnesses and same-name wrong GIN replacement refusal.

## Agreed stage budget and validation

The audited connected framework boundaries are 20 / 29 / 49 for Product,
Product + Payload and mixed workflow. Each removes three repeated canonical
structural reads (Application activation, legacy revision-schema projection and
binding activation/candidate/lane join) and three redundant scope-clock probes,
totaling 120 / 174 / 294 dispatches. The original budget allowed three added
preparation reads per root and set stage ceilings of **871 / 1,081 / 1,688 SQL
dispatches** with **41 / 52 / 78 transactions**; standalone remains **354 / 6**.
Those source/trace-derived ceilings remain unchanged.

The [retained prepared-admission measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/prepared-admission/README.md)
meet every stage ceiling on the unchanged graphs:

| Graph | SQL dispatches | Transactions | Warm p50 / p95 (ms) | Retained warm maximum (ms) |
| --- | ---: | ---: | ---: | ---: |
| Product | 862 | 41 | 783.7 / 1,011.6 | 1,193.7 |
| Product + Payload | 1,068 | 52 | 973.8 / 1,006.0 | 1,014.0 |
| Mixed finite workflow | 1,663 | 78 | 1,676.6 / 1,714.8 | 2,800.9 |
| Standalone finite workflow | 354 | 6 | 309.4 / 395.3 | 406.9 |

Net dispatch reductions are **126 / 184 / 316**. Actual lazy first fills add
**3 / 4 / 7** full epoch captures: two Application structures plus one binding
snapshot per source-admission preparation context. The actual benchmark lifetime
is request/series-owned, outside retained-host allocation. Full tail guard counts,
the six kernel statements and transaction topology remain unchanged. All samples
and outliers are retained with zero exclusions. Standalone passes its median and
regression gate; the three mixed final latency goals remain unmet.

Extra server work for the full 23-table attestation and decode/hash CPU remain
unavailable attribution. Driver await includes transport, server and waits;
traced phase spans overlap and are not untraced latency acceptance. Account for
invalidation/reprepare, retries and contention without exclusions. No combined
call hides its server statements. Final p50/p95 100/200, 200/400,
500/1,000 ms goals and standalone median below 400 with regression strictly below
10% remain [slice 14](./14-execution-redesign-roadmap.md#budget-and-attribution-gate)
acceptance gates; later slices own the remaining graph topology.

Prove every added table's zero-row INSERT/UPDATE/DELETE/TRUNCATE invalidates and
rolls back in PGlite and ordinary-role Postgres. Cover direct DML, key movement,
missing/extra closure, denied epoch/TRUNCATE/trigger bypass, role/installation
changes, pooled reuse/reconnect, stale incarnation and distinct-connection
writer-change/busy/race behavior. Canonical corruption with unchanged digest must
fail preparation; changed target bytes must revoke reuse. Live head, source,
required lifecycle/coverage and physical tamper checks must remain decisive.

Run real Product, selected Payload Local API and finite workflow success,
pending/OCC, late failure, rollback-only, retry, events, replay, cancellation and
uncertain-COMMIT recovery plus standalone regression. Apply Effect patterns and
error guidance to changed composition/lifetimes, then affected types/builds,
source/Worker guards and lint, both project reviewers and substantive-fix
re-review. Root owns final validation, cleanup and one scoped commit. Delivery
requires connected migration/removal, preserved correctness and the agreed stage
budget; keep any remaining latency gap quantified with its later owner. Developer
APIs, new operations, hosted activation and advanced evolution remain outside scope.
