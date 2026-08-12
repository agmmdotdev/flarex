# Preflight 39: Standard Application Task Runtime Publication

## Status

**Decision:** Approved. SAP-TRP1 and SAP-TRP2 are complete as
production-inert pure checkpoints. SAP-TRP3 is complete as a private,
production-inert immutable object-store checkpoint. SAP-TRP4 now has the
repository-grounded schema/transaction proposal in
[`40-standard-application-task-runtime-persistence.md`](./40-standard-application-task-runtime-persistence.md),
but implementation remains pending explicit approval. SAP-TRP5 and SAP-TRP6
remain pending and require the ordered approvals below.

This is the upstream owner gate discovered by DTE06-D1. It does not authorize
DTE06-D2, Worker Loader composition, a compute provider, a host, activation, or
durable execution. It supplies the canonical object contracts and immutable
publication evidence that later adapters must consume.

## Current Evidence And Missing Owner

DTE06-D1 now has a private `TaskRuntimeLaunchAuthority` that correlates one
compute request with C2 prepared evidence, a full runtime binding, and exact
runtime-object references. It requires a trusted role-codec validator before
returning any body.

The committed repository currently provides:

- canonical task manifests, catalog/binding evidence,
  `TaskRuntimeEntryFrameV1`, five object-reference roles, and the full runtime
  binding in `@flarex/standard-application-definition`;
- canonical task manifest and definition-binding storage under the inactive
  application revision in `fx_system_application_task_definition_v1`;
- the later full binding captured for a run in
  `fx_system_durable_task_definition_revision_v1`; and
- reusable content-addressed R2, projection/module publication, cold
  materialization, readiness, and activation mechanics for ordinary function
  groups.

It does not provide:

- canonical task projection, group-manifest, materialization-spec, or task
  module body codecs;
- a producer deriving all five bodies from authenticated application evidence;
- immutable task-object publication and replay/conflict semantics;
- task publication evidence joined to application readiness and activation;
  or
- a production located reader/role validator for DTE06-D1.

This is therefore a Standard Application publication/readiness responsibility,
not a backend adapter convenience. Publishing inside the compute adapter would
duplicate artifact authority and let a runtime reader mint evidence that must
exist before activation.

## Reuse Decision

Reuse existing Flarex owners by capability without pretending task formats are
ordinary function formats:

| Concern | Decision | Owner |
| --- | --- | --- |
| Task manifest, catalog, entry, and runtime-binding identity | Reuse and extend | Standard Application definition |
| Canonical physical mechanics | Reuse only where exact field/codec semantics agree | protocol/definition owner |
| Authenticated module-source selection | Derive from existing candidate/source/runtime authority | Standard Application publication composition |
| Immutable R2 put/get, digest, collision, ownership, and uncertainty mechanics | Generalize/adapt behind task-specific references | existing artifact-runtime owner |
| Publication transaction and replay authority | Add task child evidence under the existing application revision | persistence owner |
| Readiness and activation | Extend the single existing application revision chain | existing readiness/activation owner |
| Task launch reads | Add the real located adapter only after readiness | DTE06-D1 adapter |
| Worker Loader and task RPC | Defer | DTE06-D2/D3 |

The ordinary Declarative V2 object kinds cannot be silently relabelled as task
roles. Shared storage mechanics are reusable; concrete compatibility codecs and
semantic frames remain task-owned.

## Accepted Object Model

The store identity remains
`flarex.r2/standard-application-task-runtime/v1`. The canonical key remains:

```text
standard-application-task-runtime/v1/<role>/<lowercase-sha256>
```

The closed roles are:

1. `runtime_projection_module`;
2. `task_runtime_projection`;
3. `task_runtime_entry`;
4. `task_runtime_group_manifest`; and
5. `task_runtime_materialization_spec`.

Every role gets an explicit compatibility codec. A valid reference and digest
are not a substitute for role decoding. Each codec must prove strict fields,
exact identity/version, canonical re-encoding, bounded sizes/counts,
deterministic ordering, owned bytes, and semantic correlation.

### Runtime projection module

The module frame commits its task-owned codec, deterministic ordinal and
artifact module path, authenticated Source Artifact V2 role mask and source
digest, raw byte length, owned source bytes, and exact `isolate` / `es_module`
metadata. The
first version embeds those authenticated source bytes in the canonical module
frame, matching the existing cold-materialization mechanics; it does not add a
second nested task-module reference. It may conservatively
include authenticated runtime-role modules because a complete transitive import
graph is not published. It remains bounded and rejects duplicate or reserved
paths. Modules are ordered by exact UTF-8 artifact-path bytes before ordinals
and roots are assigned.

### Task runtime projection

Implement the accepted `TaskRuntimeProjectionFrameV1`: exact `durable_task`
group, execution module, module count, raw byte length, and ordered module-root
digest. Database collation and input array order cannot define the root.

### Task runtime entry

Reuse the implemented `TaskRuntimeEntryFrameV1` and
`flarex.standard-application/task-runtime-entry/v1` codec. The body must match
the selected task ID, manifest digest, module/export, projection digest,
ordinal, and `durable_task` group.

### Task runtime group manifest

Implement the accepted `TaskRuntimeGroupManifestFrameV1`: catalog digest, task
count, entry root, projection digest, and materialization-spec digest. It is not
the function-group manifest with a changed tag.

### Materialization specification

Implement `TaskRuntimeMaterializationSpecV1` as provider-neutral immutable
policy. SAP-TRP1 fixes the runtime identity as
`flarex.task-runtime/durable-task/v1`, the private bridge identity as
`flarex.task-runtime-rpc/v1`, the runtime profile as
`flarex.worker-loader/task-runtime/v1`, and the module-entry policy as
`flarex.task-runtime/module-entry/exact-artifact-path/v1`. It also commits the
compatibility date/flags, implementation version, a deterministic sorted
compute-profile set admitted for the catalog, and
deterministic module-entry construction policy. Credentials, account/region,
ephemeral Worker names, attempts, leases, and provider execution IDs are
forbidden.

Each task manifest remains authoritative for that task's exact compute-profile
reference; one application-level spec cannot contain one per-task profile when
a catalog may contain several. This clarifies the singular wording in
Preflight 08 without changing the existing manifest or binding shapes.

SAP-TRP1 fixes the ABI identity and specification shape. DTE06-D2 may then
implement that private ABI/runtime core under Preflight 38 while later
publication work continues. A populated catalog cannot become ready until the
spec names an implemented and admitted ABI/profile combination.

## Publication Flow

```text
registered inactive application revision
  + authenticated candidate/package/artifact/source/semantic evidence
  + canonical task catalog and definition bindings
  + trusted runtime publication policy
  -> prepare task modules, projection, entries, group manifest, runtime spec
  -> derive exact references, lengths, digests, and binding roots
  -> put immutable objects with no-replace/reconcile semantics
  -> atomically publish task runtime receipt under the same revision
  -> readiness reads and role-decodes every object
  -> existing readiness receipt commits the task binding root
  -> existing activation may commit that one ready application revision
```

R2 cannot be atomic with Postgres. Objects are immutable and safe to write
before the database receipt; exact replay converges; conflicting bytes at one
key are corruption; uncertain puts reconcile by exact read/length/digest; and
unreferenced bodies remain inert retention/GC candidates. Object existence
alone never proves publication. Database evidence correlated to the exact
revision/candidate/task binding is authoritative.

## Persistence And Readiness

Persistence requires its own preflight before DDL. At minimum it represents:

- one publication header per trusted scope/application revision and
  candidate/task-binding digest;
- exact store, role, key, length, digest, codec, and ordinal membership;
- immutable replay/publication receipt identity;
- catalog, entry-root, projection, group-manifest, materialization-spec,
  package, artifact, source, and semantic correlation; and
- fields needed by existing readiness, activation metadata, and active
  selection.

Do not store raw bodies in Postgres merely to avoid defining R2 authority. Do
not add a task-specific active head. A populated task catalog with missing,
unsupported, or corrupt runtime evidence makes the whole revision unready in
the first vertical. An explicit empty catalog requires no task runtime objects.

Readiness cold-reads and role-decodes every required object under bounded
policy, recomputes roots, verifies supported materialization policy, and proves
the module graph has no collisions. Only the existing readiness owner emits the
fact used by activation; publication alone is not readiness.

## Located Read Authority For DTE06-D1

After publication/readiness exists, the production D1 adapter must:

- resolve trusted scope/database/store targets without caller routing;
- load C2 prepared evidence and the exact canonical definition binding;
- prove that binding points to a published, readiness-approved task runtime
  publication for the same immutable application revision;
- read only references in that binding from the fixed task store;
- use the role-owned codecs above;
- return owned bytes/input evidence with typed unavailable, corruption,
  resource, and unsupported-runtime failures; and
- expose no DB, transaction, bucket, credential, generic key reader,
  publication/readiness mutation, or lifecycle authority.

It never republishes, repairs missing bodies, reads the current active head, or
synthesizes a new binding. Existing runs retain their captured revision.

This preflight owns only the Standard Application runtime-object half of the
located source. `TaskInputReferenceV1` points to the distinct
`flarex.task-input-object-store.v1`, is created per run, and has
`run_lifetime` retention. Its content-addressed writer, creation ordering,
reader, availability proof, and GC contract require a separate Task run-input
object-store preflight. Application publication must not write input bodies,
and SAP-TRP6 cannot by itself claim the complete production D1 source or
unblock DTE06-D2.

## Retention

Referenced objects remain available while any supported retained run can
resolve its definition revision. Deactivation or a later application revision
cannot delete shared or still-referenced task bodies. Conservative retention is
acceptable initially. Deletion/GC needs a later preflight with exact
reachability from published revisions, definition revisions, live and retained
runs, and shared content-addressed references.

## Ordered Checkpoints

### SAP-TRP1: Canonical role contracts

**Complete (2026-08-12).**

- implement missing module, projection, group-manifest, and
  materialization-spec models/codecs;
- reuse the task-entry codec;
- define budgets, ordering, roots, keys, and correlation;
- add golden, hostile, excess-field, malformed UTF-8, noncanonical, duplicate,
  overflow, and field-sensitivity tests; and
- remain pure with no persistence or R2.

The implemented contract supplies:

- strict models and canonical codecs for projection modules, the task
  projection, group manifest, and materialization specification;
- a strict canonical decoder for the existing task-entry body, so every one of
  the five stored roles has a role-owned decode/re-encode path;
- separate typed module-root and task-entry-root preimages, including the fixed
  canonical empty task-entry root;
- exact UTF-8 artifact-path and compute-profile ordering, contiguous ordinals,
  duplicate/reserved-path rejection, bounded role masks, module/source/total
  byte ceilings, and exact source length/digest verification during root
  construction;
- owned byte capture, fatal UTF-8 source validation, canonical unpadded
  base64url module bodies, lowercase digest text, exact object fields, and
  noncanonical-preimage rejection; and
- pure digest/correlation operations that prove projection count, total bytes,
  module root, and execution-module membership without persistence, R2,
  readiness, Worker Loader, or provider authority.

Validation receipt:

- `pnpm --filter @flarex/standard-application-definition typecheck`;
- `pnpm --filter @flarex/standard-application-definition test` — six files,
  50 tests;
- `pnpm check:trigger-compatibility-boundary`;
- focused diff checking and both required project reviewers before commit.

The repository-wide Standard Application boundary checker currently has a
pre-existing source/export-policy mismatch with the already committed
`applicationSource` and `applicationTaskBinding` surfaces. SAP-TRP1 does not
change those surfaces or weaken that checker; its correction remains with
their owning slice.

### SAP-TRP2: Pure publication preparation

**Complete (2026-08-12).**

- derive every body/reference from authenticated prepared Standard Application
  evidence and trusted runtime policy;
- prove all candidate/binding/artifact/source/semantic correlations;
- produce an owned immutable plan and receipt preimage;
- reject collisions, missing execution module, unsupported policy, and budget
  breaches; and
- perform no DB, R2, readiness, activation, or Worker Loader operation.

The package-local `prepareTaskRuntimePublicationV1` now reuses the existing
prepared Standard Application graph, hashed task catalog, application task
bindings, SAP-TRP1 codecs/digests, and SHA-256 capability. It rehashes the
catalog, decodes and hashes one candidate frame that commits the
package/artifact/source/semantic roots, correlates that frame to the exact
scope/candidate/revision and authenticated Source Artifact root evidence,
verifies ordered authenticated module membership, enforces the
trusted compatibility/implementation/compute-profile policy, and derives the
application-task binding digests and application-revision task-binding digest
rather than accepting unchecked digests from its caller. Populated catalogs
retain private owned canonical bodies behind copy-on-read accessors, exact
store/role/codec/ordinal/key/length/digest membership, binding roots, and an
immutable publication-receipt preimage. Explicitly empty catalogs produce a
derived empty entry root and binding with no runtime objects.

Validation receipt:

- `pnpm --filter @flarex/standard-application-definition typecheck`;
- `pnpm --filter @flarex/standard-application-definition test` — seven files,
  54 tests; and
- focused SAP-TRP2 preparation tests cover deterministic replay and defensive
  ownership, empty catalogs, forged catalog/source/binding evidence, and
  unsupported runtime policy.

After SAP-TRP1 closes, DTE06-D2 is no longer blocked on undefined object/spec
contracts and may proceed independently. DTE06-D3 remains blocked on SAP-TRP6
and the separate run-input object-store gate.

### SAP-TRP3: Immutable object-store adapter

**Complete (2026-08-12).**

- reuse existing R2 mechanics behind the task-specific reference;
- prove bounded no-replace put/read, replay, collision, reconciliation,
  ownership, and typed failure;
- use in-memory/Miniflare and later hosted Cloudflare proof; and
- expose no generic bucket/key authority.

The backend now owns one package-local immutable R2 byte-store core extracted
from the already proven Declarative V2 runtime-artifact adapter. That core
retains conditional no-replace create, exact bounded streaming reads,
defensive body ownership, digest and byte-length verification, replay
convergence, collision detection, resource-cause retention, and uncertain-put
reconciliation. The existing Declarative V2 adapter now delegates to that
same core, so SAP-TRP3 reuses the storage algorithm instead of copying it.

The private `TaskRuntimeObjectStore` adapter accepts only SAP-TRP2
`PreparedTaskRuntimeObjectV1` values for publication and exact
`TaskRuntimeObjectReferenceV1` evidence for reads. It derives no arbitrary key,
exposes no bucket or generic immutable-store capability, validates the fixed
task store/role/key/length/digest contract, and returns owned bytes and copied
references. The Trigger compatibility gate admits the shared core only to the
Declarative V2 and task-runtime store adapters and rejects production consumers
of the unwired task store.

Validation receipt:

- `pnpm --filter flarex-backend typecheck`;
- focused in-memory, existing Declarative V2 regression, and Miniflare R2
  tests — three files, 16 tests;
- Trigger compatibility boundary checker — 28 tests plus the live checker;
- `pnpm typecheck:scripts`; and
- offline frozen-lockfile install after explicitly pinning the already resolved
  `workerd` peer required by the Miniflare lane.

Hosted Cloudflare R2 remains a deployment-environment proof before production
activation. SAP-TRP3 does not publish a database receipt, readiness evidence,
or active revision and does not wire a route, Worker, Queue, Cron, or host.

### SAP-TRP4: Persistence publication

- use the separately proposed minimum schema/migration/repository contract in
  [Preflight 40](./40-standard-application-task-runtime-persistence.md);
- add the Standard Application-owned canonical receipt codec/digest before
  persisting its normalized evidence;
- serialize competing publication, converge replay, and reject corruption;
- prove rollback and genuine-PostgreSQL concurrency/uncertainty; and
- remain inactive and unwired.

### SAP-TRP5: Readiness and active-selection agreement

- extend the existing application readiness/activation evidence chain;
- cold-read, role-decode, and recompute all task roots;
- prove empty/populated catalog and unsupported-runtime policy;
- project a narrow task basis from issuer-owned active selection; and
- create no second readiness receipt or task head.

### SAP-TRP6: DTE06-D1 located adapter

- implement the trusted definition/runtime-object/read/role-codec portion of
  the located adapter;
- prove exact definition/publication/readiness correlation and restart lookup;
- test corruption, unavailable, wrong-scope, stale resource, hostile driver,
  ownership, deadline/settlement, and retention; and
- keep Worker Loader, provider composition, and host absent.

The separate run-input object-store checkpoint must later compose the exact
input reader before the full D1 production adapter is complete.

## Required Validation

Use focused package typechecks/codecs, golden vectors, package boundaries,
object replay/collision/uncertainty tests, PGlite and genuine PostgreSQL for
persistence changes, Miniflare and hosted Cloudflare before R2 production
claims, cold-read readiness proof, D1 located-reader integration after TRP5,
frozen-lockfile/diff checks, and both required reviewers for significant code.

## Explicit Non-Goals

This does not authorize widening `TaskComputeDispatchRequestV1`; raw R2/DB
authority in providers; a second store/materializer/module graph/readiness or
activation system; action/`/invoke` fallback; publishing from run creation or
launch; DTE06-D2/D3/D4, DTE06-E, or DTE05 activation; public SDK/HTTP/live UI;
routes, Queue, Cron, Worker, binding, deployment, production activation; eager
deletion; or Trigger Prisma/Redis/product-host imports.

It also does not authorize task-input publication. Task inputs are run-owned,
not application-revision artifacts.

## Stop Boundary

Approval and implementation close SAP-TRP1 through SAP-TRP3: the pure canonical
role contract, publication preparation, and private immutable object-store
checkpoints. DTE06-D2 may proceed
under its already approved Preflight 38 because the private
ABI/materialization identities are fixed;
that does not authorize DTE06-D3 or any production composition. SAP-TRP4 is
the next Standard Application checkpoint. Its fresh schema/migration preflight
is now recorded in Preflight 40 and awaits explicit implementation approval.
DTE06-D1 remains a
committed contract/verification foundation but production-incomplete until
SAP-TRP6 and the separate run-input object-store gate both close. DTE06-D2 does
not begin merely because this preflight document exists.
