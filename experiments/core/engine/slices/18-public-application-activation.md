# Fresh ordinary public Application activation

Status: **Fresh ordinary public activation implemented and reviewed;
production and registered-upgrade gates remain open.**

Baseline: `402a06a99a01eb4131ac365c7dfa37efa2112f7c`. Reference:
`db914cf06e2b06ee985646611b9e12ed7a770318`. This completes the public-path
gate of the [executor cutover](./17-executor-cutover.md), under the existing
[goal](../GOAL.md). Use the shared checkout, preserve unrelated changes, and do
not deploy. Task replacement and performance measurement remain paused.

## Challenge and disposition

The current public start uses legacy analysis and a JSON R2 package, then the
DeploymentDO's SQLite candidate. Finish activates only that metadata. Core's
actual analyzer needs a finalized SourceArtifactV2 root; its configured source
pins currently require operator/test injection. Calling Core registration and
then the existing SQLite finish is unsafe: another start or abandon can change
the candidate while PostgreSQL commits the first source.

Pinned `application/deploy_config.rs::start_push/finish_push` prepares immutable
source and schema work before atomically publishing source/module/schema/index
identity. `bootstrap_model/schema::SchemaModel` activation rechecks the actual
proposal state; identical active schemas are no-ops. Source does not establish
latest-start-wins for same-schema code-only pushes. The new bounded profile
refuses competing pending roots and registered upgrades explicitly.

| Current owner | Keep / adapt / replace |
| --- | --- |
| Public push/discovery/invoke Worker | Adapt the actual routes to select an explicitly configured Core target before legacy candidate or artifact construction |
| SourceArtifactV2 upload, attempt and finalized-reader owners | Compose a genuine production source-package producer; preserve function/dependency roles, maps, exact bytes and separate package/root digests |
| Actual Application analysis host and Core schema/program producers | Keep one analysis authority; persist its canonical manifest and package evidence with the pending candidate |
| Core logical `_schemas` and registration lifecycle | Own candidate identity/disposition, readiness, cancellation and atomic complete activation; no second installer or settlement engine |
| DeploymentDO SQLite candidate/active metadata | Retain for named legacy profiles; remove it from the fresh Core activation authority path |
| Public authentication and code generation | Derive admitted metadata from the same accepted manifest/package evidence; preserve inline JWT configuration and refuse unsupported executable auth modules explicitly |

The [public activation divergence](../divergences/public-application-activation.md)
records the necessary source-storage/host adaptation.

## Connected contract

Trusted static configuration owns deployment/scope/epoch, canonical DO/storage
identity, keys, analyzer/policy, compatibility/generation settings and resource
budgets. Uploaded source root, package identity and analyzed function closure
belong to the candidate and activated Core registration. Public JSON cannot
choose a raw persistence target, epoch, signer, analyzer or program publication.

Authorized public start accepts source, authenticates/materializes its complete
package, finalizes genuine R2 contents, runs the actual analyzer and prepares an
inactive Core schema candidate. Candidate evidence binds the exact canonical
manifest and package to complete registration/schema/program provenance. Cold
finish reconstructs programs from this evidence, rather than accepting public
analysis or running a different analyzer. Core's internal direct registration
path and test injection are replaced as their real callers migrate.

Finish advances the existing readiness owner and activates the exact proposal
and complete publication in PostgreSQL. Public status, active discovery and
invocation derive from this authoritative closure; SQLite is not a second gate.
Repeated identical start/finish and lost acknowledgements reconcile the same
candidate. Serving never installs on a miss. Unsupported analyzed-start bypasses
and changed-source upgrades refuse before publication.

Abandon and finish serialize through Core proposal state. Cancellation may
retire only the candidate's authenticated empty staged logical metadata, with
tracked dependencies and preserved physical history; it does not delete durable
application data. A foreign row, program, table or ownership mismatch refuses
cleanup. A later fresh start must not inherit abandoned authority. No database
transaction spans source upload, analysis, untrusted execution or remote effects.

Existing legacy deployment/orphan exclusion remains mandatory. Independent
legacy provisioning/writing hosts must be excluded before fresh activation.
Registered upgrades, partitions, native-policy manifests and Core subscriptions
remain their own gates. The local public proof does not close managed production
AA-R9, deployment, capacity or performance gates.

## Ownership and proof

Core owns registration/candidate evidence, conditional state transitions and
empty staged-metadata retirement. Executor composition owns genuine upload,
analysis, producer reconstruction and bounded private transport. Backend owns
public authorization, route selection and faithful metadata/codegen projection.
The root owns connected actual-host proof, configuration/docs, exact shared
checkout staging, validation and both mandatory read-only reviews.

Required witnesses include public source-only start/status/codegen/finish through
backend, service binding, canonical DO, actual analyzer and isolated query/mutation
execution. Prove inactive refusal, exact root/package/maps/dependency identity,
inline JWT identity and public visibility, kind/args/ID/value fidelity, mutation
replay, repeated finish and lost acknowledgements, cold reconstruction,
interrupted preparation, finish/abandon/start races, malformed/foreign/unsupported
source and fresh-target refusal. Exercise Core state/settlement cases on PGlite
and ordinary-role PostgreSQL separately; prove host/resource claims in Workerd.

Migrate source/test callers and remove the displaced direct-registration path
and fixture-only upload construction from this public graph. Preserve unrelated
legacy recovery and native/Task consumers with their existing removal gates.

The normal HTTP push coordinator discovers the configured public profile before
bundling. Core bundles keep canonical SDK imports and reference the packaged
function modules directly; compiler-generated namespace getter shims are not a
runtime ABI. Core code generation emits typed API, server and data-model files
and removes stale legacy runtime output. Analyzed declaration table/index IDs
remain declaration metadata, never legacy runtime storage identifiers. Public
Core partition, sync, execution and scheduler routes refuse at the profile
boundary. Legacy generation remains attached to explicit compatibility targets.

The actual public proof covers both a source package with dependency/maps and
the normal server-discovered SDK build/deploy path, including inline JWT identity,
cold activation/replay and post-activation identical deploy. The positive host
proof selects a long scheduler wake interval; separate controlled paired Core
races cover background metadata changes and normal OCC refusal. There is no
adapter retry loop or no-conflict promise for administrative operations.

Source publication verifies exact map presence and bytes, including UTF-8
byte-order marks. Present zero-byte maps refuse before storage side effects
because the current framed format cannot represent them. This boundary does
not weaken package identity by normalizing empty maps into absent maps.

## Shared catalog correction

The paired cancellation/restart witness requires logical table/index metadata
retirement to update both stored rows and the live registry. Existing
`transaction.writeSystem(TABLES, null)` and committer registry application now
propagate table removal, so a cancelled empty candidate does not leave its
retired tables visible to the next start. The temporary caller workaround is
removed; old snapshots and physical history remain preserved.
Cancellation/restart and existing schema/native regressions gate the dependent
public cancellation path on both database drivers.
