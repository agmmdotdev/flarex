# Whole-function executor cutover

Status: **Bounded fresh ordinary Application path implemented and reviewed;
activation gates remain.**

The [fresh public activation continuation](./18-public-application-activation.md)
owns the source-upload through public invocation gate.

Baseline: `a025de282921b344299fc29d21cb9ed567a9c6e1`. Convex pin:
`db914cf06e2b06ee985646611b9e12ed7a770318`. This continues the
[full goal](../GOAL.md) and [retirement ledger](./16b-legacy-entrypoint-retirement.md).
Use the shared checkout and preserve other sessions' changes. Task replacement
and performance measurement remain paused.

## Connected contract

The configured executor's old `/invoke/prepare`, `/start`, `/syscall`, `/finish`,
`/abort` and `/abort-stale` routes implement a persisted session protocol. The
backend/artifact caller executes untrusted code between those HTTP requests.
The replacement admits a complete ordinary Application query or mutation and
uses the existing retained canonical app owner. Do not hold a Core transaction
across the old series or accept a caller-supplied final write/result transcript.

The connected path is trusted app registration and genuine finalized source
analysis -> shared Core schema/index/program activation -> actual backend
caller -> bounded whole-function transport -> canonical app DO -> existing
Application runner -> PostgreSQL settlement/recovery. A factory or unused
endpoint alone does not complete this slice.

| Current owner | Keep/adapt/replace |
| --- | --- |
| Configured executor Worker and private service bindings | Authenticate before resource allocation; resolve only trusted registered app routing to its canonical DO |
| `GeneratedWorkerSource` PostgreSQL lifecycle RPCs and artifact/backend invocation | Replace the admitted Core profile's external execution/session choreography with a whole-function call; keep any remaining compatibility profile explicit and named |
| Finalized R2 source reader and actual `FlarexApplicationAnalysisHost.analyze` | Reuse authenticated finalized content, cold analysis and canonical manifest verification; never cast legacy deployment analysis into a new manifest |
| `compileCoreApplicationSchema` / `makeCoreApplicationPrograms` | Reuse genuine ordinary-profile producers; reject unsupported native/policy manifests rather than stripping declarations |
| Core schema prepare/build/activate and `CoreApplicationOwner` | One logical lifecycle and one settlement/recovery owner; no new installer, transaction engine or adapter DDL |
| Mutation grant issuer, context/cursor factories and Worker runners | Compose real owners with trusted stable keys, policy and bounded resources; no fixture constants or per-generation cursor/signer reset |
| Existing deployment project-scope lookup and query-sync metadata endpoints | Preserve these distinct named owners until their actual consumer cutover; a function transport does not replace them |

## Routing, registration and old data

A bounded trusted routing map owns deployment/scope/epoch, canonical name,
physical namespace/instance, keys, analyzer policy and resource settings. Source
provenance belongs to the prepared and activated Core candidate.
HTTP request, response and registration body budgets are explicit per-profile
settings, validated before opening the app's pool.
Private signing/cursor secrets come from trusted configuration, never invoke
JSON. The router and DO use the same authenticated mapping. Unique or wrong-name
DOs must refuse without opening a persistence owner.

The map declares fresh Core and retained legacy deployment identities explicitly.
Its envelope requires an explicit `maximumLegacyRequestBytes` when retained
legacy profiles are present. The gateway consumes that bounded original body
once and forwards the exact bytes after selecting the admitted legacy identity.
An absent, withdrawn or unready Core entry never becomes a legacy profile. The
backend binds the candidate's source package identity and finalized artifact root.
The DO answers a Core profile lookup only after checking persisted admission.

Registration is a separate trusted operation. It reads genuine finalized R2
source, invokes the actual analyzer and atomically activates the derived ordinary
schema/index/program closure through Core. Serving a missing program must not
trigger an installation fallback. Incomplete or unsupported preparation leaves
the previous ready configuration intact. Invocation cannot install a manifest,
choose a raw database instance or grant itself a transaction capability.

Interrupted preparation resumes through the shared
[registration admission extension](../divergences/application-registration-admission.md).
Its proof is part of the existing logical schema lifecycle and complete program
publication, rather than adapter preflight table checks.

An empty new instance is not a migration of an existing deployment. Fresh-target
admission and an already installed matching profile have distinct proofs.
Mismatched/nonempty old targets refuse until their named conversion or retained
recovery obligation is resolved. No data reset or legacy session conversion is
authorized by this slice. Historical outcome disclosure remains separate from
permission to execute a new function.

Fresh admission also asks the existing PostgreSQL control owner whether the
deployment identity already has legacy authority. An existing deployment row
refuses even when the selected Core target is empty. Old invocation preparation
requires that committed row before it can start a session. The configured gateway
denies every legacy lifecycle call for a Core identity before opening the old
engine. Activation therefore requires all external legacy provisioning/writing
owners for those identities to be drained or excluded; the instance-local Core
guard does not fence an independently operated legacy host. This slice adds no
cross-engine migration or new physical reservation table.

The old optional `idempotencyKey` was stored under a nonunique index; every old
start generated a new session ID. New whole-function requests have an explicit
outer correlation key tied to scope, function/source, arguments and identity.
Generate an omitted key once at the trusted outer call, retain it across uncertain
transport, and let Core own claim/replay/recovery and eligible OCC retries. Never
alias old session IDs to new keys or add another callback retry loop.
Independent public requests without an explicit idempotency key remain
independent calls; this does not promise recovery across newly generated keys.

## Query evaluation boundary

Core queries produce an exact `CoreReadToken` with bigint timestamp, index
identities/intervals and any metadata frontiers. Expose that outcome through the
query owner while preserving the existing value-only projection and one finish/
drain lifetime. The new wire uses canonical exact encodings and a separate Core
evaluation variant. Native monetary/value and document-ID fidelity survive the
wire boundary.

The existing connection/subscription consumer requires legacy numeric `readTs`
and `readSet`; Core's timestamp is not a legacy `CommitSeq`. Migrating that caller
requires its actual evaluation and invalidation contract, or an explicitly named
retained legacy storage profile. Do not fabricate old dependencies, convert bigint
timestamps with `Number`, drop evaluation evidence or route one app's reads and
writes to different engines. Unsupported Core subscription use refuses explicitly.

## Ownership and proof

| Owner | Implementation responsibility |
| --- | --- |
| Validation | Minimal repairs to authoritative source encoding, bound system `validateIds`, tagged candidate-root fixture and canonical public Worker artifact generation; preserve unrelated WIP |
| Protocol/HTTP | Strict bounded Core request/result codecs, bound service client/handler, exact query evaluation and genuine mutation outcome projection |
| App composition/DO | Trusted registered profile resolution, genuine source/analyzer/producer composition, stable capabilities, explicit registration and current retained owner lifecycle |
| Root integration | Configured Worker/DO exports and bindings, actual backend caller selection, source/data/profile refusal, owning documentation, connected tests and scoped review/commit |

Prove actual backend/service-binding/DO/isolated-Worker query and mutation calls,
authentication/config rejection before allocation, route/source/scope confinement,
public visibility, argument/result/ID fidelity, nested read-only behavior,
exact evaluation, conflicting keys, committed replay and lost acknowledgement.
Exercise cancellation/drain, wrong/unique DO identity, cold reconstruction,
interrupted registration/build and owner replacement through actual local
Workerd. Any migrated sync profile needs real dependency/invalidation witnesses.

Run affected types, generators, source/boundary guards, core/diff/exact-index lint
and both mandatory read-only reviews. Database installation, transaction,
isolation, migration and plan claims need PGlite and focused ordinary-role
PostgreSQL separately. Keep managed hosting/capacity and paused performance
claims distinct. Preserve failing witnesses and fix the actual shared owner.

Remove each migrated caller's old route/materialization construction and unused
exports/tests in the same connected scope. Named compatibility/recovery, native,
Task and sync consumers stay recorded in the retirement ledger until their own
proof closes. This slice cannot claim the whole legacy engine retired while
those actual callers or historical obligations remain.

## Bounded completion and remaining activation

The configured Worker exports `FlarexApplication` and routes authenticated Core
requests directly to the canonical DO. Its trusted composition uses finalized R2
source, the actual analysis host, Core schema/program activation, stable keys,
the retained query/mutation owners and the same PostgreSQL pool. The backend's
Core transport selection bypasses old artifact materialization. Named legacy
profiles retain the old lifecycle; absent Core admission refuses.

Core's optional logical schema provenance now owns interrupted registration and
complete program closure enforcement. Profile discovery reads a compact
authenticated identity projection. Complete closure authentication is reused
only for the exact immutable Core registry;
each read retains live metadata dependencies and reconstruction revalidates.
The profile supports ordinary unpartitioned public queries and mutations.
Partition/native-policy manifests,
Core subscriptions and registered runtime upgrades remain refused until their
specific contracts are implemented.

The [fresh public continuation](./18-public-application-activation.md) connects
source-only upload, actual analysis, Core candidate activation, public discovery
and invocation through the real backend/service-binding/DO/isolated-Worker graph.
Normal SDK generation discovers the target profile and emits Core-compatible
typed files. Wrangler's explicit registry starts empty. No deployment or durable-data
conversion is performed here. External legacy writers must be excluded before
admitting fresh identities; retained legacy recovery and sync remain in the
retirement ledger. Managed Cloudflare capacity and performance remain unproven.

Validation repairs to pre-existing uncommitted system-schema/source-command and
tagged-root fixture work remain with that work's owner in the shared checkout.
Their source is not absorbed into this cutover commit. Task source provenance is
reconciled; its separate compatibility/host admission and paused replacement
remain open.
