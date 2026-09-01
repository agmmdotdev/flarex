# Artifact, Installation, And Binding Identity Preflight

## Status And Authorization

**Preflight status:** accepted on 2026-08-30; private artifact-value checkpoint
implemented on 2026-08-30. The separately gated artifact repository, DDL,
control-session, and PGlite plus genuine-PostgreSQL acceptance are also complete.
The current Application lifecycle, scope authority, catalog identity,
persistence placement, and Effect ownership have been audited. This record
freezes the additive architecture and exact artifact-envelope contract.
Installation, readiness, availability, Application-bridge, and binding
persistence codecs remain later preflights.

The completed checkpoint is limited to the owner-qualified artifact value
model, canonical capture, digest policy, capture failures, and contract tests
inside the private persistence owner. This record does **not** authorize:

- new relational DDL or a framework installation migration;
- an installation, readiness, availability, or binding repository;
- a new Application artifact writer or active head;
- a Payload or Medusa import, adapter, route, or runtime caller;
- a public API or package export;
- production selection; or
- a fallback, comparison path, dual read, or dual write.

Those boundaries are deliberate. The completed artifact checkpoints prove that
every later stored coordinate has one meaning before installation or binding
authority exists.

## Accepted Decision

Add a private framework-schema domain beside the existing Application
lifecycle. It has three deliberately separate identities:

```text
immutable desired artifact
           |
           v
physical installation + immutable readiness + mutable availability
           |
           v
scope-local DataBindingSet candidate/history + one framework active head
```

The existing Application active head remains the sole Application selector.
`DataBindingSet` contains a read-only exact projection of that head and its
schema/readiness/placement evidence. It never stores or persists the nominal
`ApplicationActiveSelection` capability, never writes the Application head,
and does not create a generic Application installation row.

Payload content is also not a framework schema installation. Its overlay
references the exact Application projection, stable Application table IDs, and
Application-owned write-policy evidence. Only a Payload lifecycle artifact
that owns separate physical structures receives a framework installation.

Medusa commerce schemas and later admitted system schemas use the complete
artifact, installation, readiness, availability, and binding lifecycle.

## Current Authority Audit

The following implemented contracts are evidence and constraints, not a
generic framework lifecycle:

| Concern | Current authority | Consequence |
| --- | --- | --- |
| Application source artifact | [`applicationAnalysisV2.ts`](../../../packages/analysis/src/applicationAnalysisV2.ts) owns `ApplicationManifest` | The manifest remains Application-owned and is not widened into a framework schema union |
| Managed Application schema | [`applicationSchemaAuthority.ts`](../../../packages/persistence-postgres/src/applicationSchemaAuthority.ts) and [`applicationRelationSchemaAuthority.ts`](../../../packages/persistence-postgres/src/applicationRelationSchemaAuthority.ts) | Existing schema IDs, manifests, table bindings, and relation bindings remain unchanged |
| Stored schema-version artifact | [`schemaVersionArtifacts.ts`](../../../packages/persistence-postgres/src/schemaVersionArtifacts.ts) | Its canonical strict-JSON container is generic, but `SchemaVersionArtifactIdentity` is only deployment plus schema-version ID and the current authoritative publishers/bindings interpret it as Application schema evidence |
| Scope placement and fencing | [`scopeMetadataTypes.ts`](../../../packages/persistence-postgres/src/scopeMetadataTypes.ts), [`scopeAuthorityResolution.ts`](../../../packages/persistence-postgres/src/scopeAuthorityResolution.ts), and `TrustedScopeAuthority` | Reuse the exact physical locator and current generation, fence, and epoch; do not invent another placement authority |
| Application readiness | [`applicationReadiness.ts`](../../../packages/persistence-postgres/src/applicationReadiness.ts) and [`applicationRelationReadinessFold.ts`](../../../packages/persistence-postgres/src/applicationRelationReadinessFold.ts) | Both relation-free and relation-bearing readiness contracts must be projected faithfully |
| Application selection | [`applicationActivation.ts`](../../../packages/persistence-postgres/src/applicationActivation.ts), [`applicationActivationSchema.ts`](../../../packages/persistence-postgres/src/applicationActivationSchema.ts), and [`applicationActiveHeadRead.ts`](../../../packages/persistence-postgres/src/applicationActiveHeadRead.ts) | One scope-keyed Application head serves both readiness contracts; its exact CAS token is `{ activationSequence, headSha256 }` |
| Stable table identity | [`catalog.ts`](../../../packages/flarex-protocol/src/catalog.ts) and [`stableTableCatalog.ts`](../../../packages/persistence-postgres/src/stableTableCatalog.ts) | Existing stable table IDs may be referenced, but catalog namespace is not semantic schema ownership |

The current Application flow is therefore:

```text
ApplicationManifest
  -> candidate and analysis
  -> inactive revision
  -> publication
  -> exact schema binding and readiness
  -> one scope-local Application active head
  -> nominal active selection
  -> in-transaction query/mutation/action/task admission
```

Registration stays inactive. Activation revalidates readiness under the
located scope authority and updates one immutable-history-backed head. Runtime
admission revalidates the issued nominal selection inside its transaction.
The framework lifecycle must preserve that ordering and must not route an
Application caller through a new generic repository.

## Proven Identity Gaps

The current storage cannot safely be reused by merely adding Payload or Medusa
rows:

| Existing fact | Missing distinction or collision |
| --- | --- |
| `SchemaVersionArtifactIdentity { deploymentId, schemaVersionId }` | No semantic owner or logical lineage; current producer prefixes are convention rather than enforced ownership |
| `fx_control_schema_version` | The version stream is deployment-wide and has no semantic owner or lineage; current authoritative publication/binding consumers are Application-specific even though the stored strict-JSON envelope is generic |
| Bound Application schema and publication rows | They cannot describe multiple physical framework installations |
| `fx_system_application_active_head` | Its sole key is scope ID and it is already the one Application selector |
| `ScopePhysicalLocator` | It proves placement, not what artifact was installed, how, or whether it remains ready |
| `CatalogTableNamespace` | Its current literals resemble owner names, but it classifies logical table IDs and does not grant schema or write authority |
| Application physical-definition lifecycle | It is coupled to Application schema/readiness and cannot be relabeled as a shared framework installation |

Prefix conventions such as `application_${sha}` do not create a type-safe or
database-enforced owner dimension. Reusing the current version stream, active
head, or bound-schema rows would make one lane capable of aliasing or replacing
another lane's meaning. The accepted design therefore uses additive identities
and storage later.

## Artifact Contract Ready For Implementation

The names below are the accepted private domain vocabulary. They are ordinary
unversioned names. Only persisted frame codecs carry a numeric version because
multiple stored encodings may eventually coexist.

Every field ending in `Sha256` is exactly 64 lowercase hexadecimal characters.
It proves byte identity only inside the frame contract that defines those
bytes; a digest alone does not prove owner, admission, installation, readiness,
availability, scope, or runtime authority.

### Semantic owner

```ts
type FrameworkSchemaOwner =
  | "application"
  | "payload"
  | "medusa"
  | "system";

type FrameworkSchemaArtifactOwner = Exclude<
  FrameworkSchemaOwner,
  "application"
>;
```

`FrameworkSchemaOwner` is a distinct domain type even though its current
spellings overlap `CatalogTableNamespace`. Converting between them requires an
explicit owner policy. A table namespace never authenticates an artifact,
installation, binding, transaction, or writer.

The private artifact contract accepts only `FrameworkSchemaArtifactOwner`.
`"application"` is reserved in the broader coordinate vocabulary for the
read-only Application bridge and a possible separately approved owner
migration; it is rejected by generic artifact capture and does not authorize
generic Application artifact writes.

### Artifact coordinate and identity

The private implementation uses distinct Effect Schema brands for values that
must not be structurally substituted:

```ts
type FrameworkSchemaLineageId = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaLineageId"
>;
type FrameworkSchemaCapabilityId = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaCapabilityId"
>;
type FrameworkSchemaArtifactCodecFormat = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactCodecFormat"
>;
type FrameworkSchemaArtifactCodecVersion = Brand.Branded<
  number,
  "FlarexDB/FrameworkSchemaArtifactCodecVersion"
>;
type FrameworkSchemaArtifactSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactSha256"
>;
type FrameworkSchemaArtifactCanonicalJson = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactCanonicalJson"
>;
```

These are private nominal brands, not proposed generic utilities or public
protocol types.

```ts
interface FrameworkSchemaArtifactCoordinate {
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: FrameworkSchemaLineageId;
}

interface FrameworkSchemaArtifactIdentity
  extends FrameworkSchemaArtifactCoordinate {
  readonly artifactSha256: FrameworkSchemaArtifactSha256;
}

interface FrameworkSchemaArtifactCodec {
  readonly format: FrameworkSchemaArtifactCodecFormat;
  readonly version: FrameworkSchemaArtifactCodecVersion;
}

interface FrameworkSchemaArtifact {
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly codec: FrameworkSchemaArtifactCodec;
  readonly provenance: JsonObject;
  readonly capabilities: readonly FrameworkSchemaCapabilityId[];
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly payload: JsonObject;
  readonly canonicalJson: FrameworkSchemaArtifactCanonicalJson;
}
```

`lineageId` is a stable owner-local logical schema family. It separates, for
example, owner-local module artifacts from an owner-local aggregate artifact
without making mutable version numbers part of immutable identity. The common
core does not enumerate Medusa modules, Payload collections, or
framework-specific schema kinds. The owner adapter interprets its codec and
payload.

The common frame has its own fixed format and persisted codec version.
`FrameworkSchemaArtifactCodec` identifies the owner payload codec carried
inside that frame. Checkpoint 1 hashes exactly this JSON shape:

```ts
interface FrameworkSchemaArtifactFrame {
  readonly format: "flarex.framework-schema-artifact";
  readonly version: 1;
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly payloadCodec: FrameworkSchemaArtifactCodec;
  readonly provenance: JsonObject;
  readonly capabilities: readonly FrameworkSchemaCapabilityId[];
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly payload: JsonObject;
}
```

The public-to-this-private-domain capture boundary still accepts `unknown`, but
the only admitted caller shape has exactly these eight top-level own data
properties:

```ts
interface FrameworkSchemaArtifactCaptureInput {
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly payloadCodec: unknown;
  readonly provenance: unknown;
  readonly capabilities: unknown;
  readonly dependencies: unknown;
  readonly payload: unknown;
}
```

Every required member is an enumerable own data property. The input must have
no other own string or symbol keys. In particular, caller-supplied `identity`,
`artifactSha256`, `canonicalJson`, `format`, and `version` members are rejected,
not projected away. `payloadCodec` has exactly the own enumerable data keys
`format` and `version`; each dependency has exactly `deploymentId`, `owner`,
`lineageId`, and `artifactSha256`. Those nested records reject extra string or
symbol keys by the same rule. The normalizer alone injects the common frame's
`format` and `version`.

The checkpoint exposes no constructor that accepts precomputed identity,
canonical text, or digest fields. Its private operations are:

```ts
normalizeFrameworkSchemaArtifact(
  input: unknown,
): Result.Result<FrameworkSchemaArtifactFrame, FrameworkSchemaArtifactError>;

captureFrameworkSchemaArtifact(
  input: unknown,
): Effect.Effect<
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactError,
  never
>;

compareFrameworkSchemaArtifactIdentities(
  left: FrameworkSchemaArtifactIdentity,
  right: FrameworkSchemaArtifactIdentity,
): number;

classifyFrameworkSchemaArtifactReplay(
  existing: FrameworkSchemaArtifact,
  incoming: FrameworkSchemaArtifact,
): Result.Result<
  "exact" | "differentIdentity",
  FrameworkSchemaArtifactError
>;
```

`normalizeFrameworkSchemaArtifact` owns unknown-input decoding, bounds,
detachment, sorting, and frame assembly. `captureFrameworkSchemaArtifact`
canonically encodes that frame, applies the byte ceiling, hashes it, brands the
result, and returns an owned immutable value. The identity comparator is an
explicit package-private pure operation so later same-owner repositories and
focused tests share one complete tuple order; it is not a constructor, package
export, or caller authority. Replay classification returns `exact` only when
identity and canonical text both match; distinct identities remain distinct,
while equal identity with different canonical text is `digestCollision`.

Admission time, database time, an installation, readiness, and a binding are
excluded. The digest is lowercase hexadecimal SHA-256 of the UTF-8 canonical
JSON bytes produced by the protocol-owned canonical JSON encoder. The digest
field itself is excluded from that frame. The stored canonical text is retained
so an exact replay can be distinguished from an impossible-but-safety-relevant
digest collision.

When a real owner adapter exists, it validates payload semantics before common
capture. Common capture independently revalidates that provenance and payload
satisfy the full Flarex JSON contract: finite numbers, dense arrays, plain
objects, string keys, and no cycles; both roots must be JSON objects.
Checkpoint 1 has synthetic contract fixtures, not an owner adapter. Binary
values, big integers, and dates use an owner codec's canonical text
representation; the common core does not guess one.

Unknown containers are captured iteratively through property descriptors. A
record must have `Object.prototype` or `null` as its prototype. Its own keys are
enumerated once; every admitted string key must be an enumerable data property,
and symbol keys, non-enumerable properties, and accessor descriptors are
rejected without invoking a getter. Arrays admit only the intrinsic `length`
plus a dense sequence of enumerable own data properties from index zero through
`length - 1`; holes, accessor elements, and extra string or symbol properties
are rejected. Reflection or proxy-trap failure is a non-retryable
`invalidInput`, while a successfully read descriptor value is snapshotted once.

Traversal processes object keys in the protocol canonical JSON key order and
array elements in ascending index order. A container already on the current
ancestor path is a cycle and is rejected. Reuse of a container after it has left
that path is valid JSON-by-value input: it is counted and detached again as a
separate serialized occurrence, and the captured result makes no alias-
preservation promise.

The initial contract budgets are:

- 1 through 1,024 UTF-8 bytes for deployment, lineage, codec, capability, and
  other common identity strings, with no null code unit;
- a safe positive integer for codec version;
- at most 256 unique dependencies and 256 unique capability IDs; and
- at most 128 JSON container levels and 262,144 visited JSON nodes across
  provenance and payload; and
- at most 1,048,576 UTF-8 bytes for the complete canonical artifact frame.

The provenance and payload roots are each container level one. Entering an
object or array child adds one level; primitive children add no container
level. Every container occurrence and primitive occurrence counts as one node,
including both roots, while property names do not count. A shared acyclic
container counts at every occurrence. One combined counter visits provenance
first and payload second. Both the 128-level and 262,144-node maxima are
inclusive. Capability and dependency entries use their separate 256-member
budgets and do not consume this JSON-node budget.

Common identity strings must be primitive and nonblank under ECMAScript
`trim`, but their original spelling is preserved. Capture performs no trimming,
Unicode normalization, case folding, or path/URL interpretation. Equality and
ordering use the preserved spelling. Every common identity string must also be
a well-formed Unicode scalar sequence: an unpaired UTF-16 high or low surrogate
is rejected. Valid supplementary characters retain their original surrogate
pair and standard UTF-8 encoding. The unsigned UTF-8 comparator is therefore a
total order over admitted common identity strings.

Oversize schemas must be decomposed into exact dependency artifacts or receive
a separately reviewed budget amendment. Callers cannot silently truncate,
normalize an identifier after hashing, or raise a limit locally.

Capabilities and dependencies are normalized by sorting their exact canonical
tuple, while duplicates are rejected rather than silently removed. Capture
validates shape, owner/deployment locality, and self-lineage exclusion only; it
performs no repository lookup and makes no dependency-existence claim. A
dependency with the containing artifact's same deployment, owner, and lineage
is rejected regardless of digest. Later admission must require every dependency
to exist already, making the immutable dependency graph acyclic by
construction.

Every dependency must have the same deployment and semantic owner as its
containing artifact. The initial contract has no cross-deployment or
cross-owner artifact dependency. Application evidence enters a
`DataBindingSet` through the read-only bridge, never through a generic artifact
dependency.

Capability IDs sort by unsigned lexicographic UTF-8 bytes. Dependency
identities sort by deployment UTF-8 bytes, then the fixed artifact-owner ordinal
`payload < medusa < system`, then lineage UTF-8 bytes, then the
ASCII artifact digest. The same-deployment/same-owner rule means the first two
members normally compare equal, but retaining them in the comparator prevents
two implementations from inventing different tuple rules.

## Deferred Installation And Binding Contract Boundaries

The following sections freeze ownership, identity separation, and required
invariants. Their TypeScript shapes are target vocabulary, not authorization to
implement them in the artifact checkpoint. Their exact persisted frame
preimages, distinct brands, bounds, replay/collision behavior, repository
capabilities, and database-time encoding must be frozen by their named later
preflights.

The same sorted-unique rule will apply to installed, validated, and required
capability IDs and to every binding/reference collection. Database timestamps
will be captured as database-owned instants and encoded through the established
canonical instant contract; caller-supplied time cannot participate in an
installation, readiness, availability, or activation receipt.

Every embedded `ScopePhysicalLocator` must be captured through the existing
`captureScopePhysicalLocator` policy and stored as an owned frozen value.
Caller mutation after capture cannot alter an identity or digest.

### Installation identity

An artifact is desired state. An installation is proof that one exact physical
target reached that state through one exact admitted plan.

```ts
interface FrameworkSchemaInstallationIdentity {
  readonly artifact: FrameworkSchemaArtifactIdentity;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly migrationPlanSha256: string;
  readonly installationSha256: string;
}

interface FrameworkSchemaInstallation {
  readonly identity: FrameworkSchemaInstallationIdentity;
  readonly installedStructureSha256: string;
  readonly installedCapabilities: readonly FrameworkSchemaCapabilityId[];
  readonly installationReceiptSha256: string;
  readonly installedAt: CanonicalIsoInstant;
}
```

`installationSha256` is the digest of the exact artifact identity, physical
locator, and migration-plan digest. The immutable installation receipt then
commits to that identity, the observed installed structure, installed
capabilities, and database-owned completion time. A different plan is a
different installation proof even when it reaches the same structure.

The future migration coordinator owns how a plan is produced and executed.
This preflight reserves its digest in identity but does not define a migration
language or authorize execution.

### Readiness and availability

Installation completion and serving availability are separate:

```ts
interface FrameworkSchemaReadinessReceipt {
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly installedStructureSha256: string;
  readonly validatedCapabilities: readonly FrameworkSchemaCapabilityId[];
  readonly validationSha256: string;
  readonly readinessSha256: string;
  readonly validatedAt: CanonicalIsoInstant;
}

type FrameworkSchemaAvailabilityStatus =
  | "ready"
  | "withdrawn"
  | "superseded"
  | "quarantined";

interface FrameworkSchemaAvailabilityToken {
  readonly availabilitySequence: bigint;
  readonly headSha256: string;
}

interface FrameworkSchemaAvailabilityHistory {
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly availabilitySequence: bigint;
  readonly previousAvailability: FrameworkSchemaAvailabilityToken | null;
  readonly status: FrameworkSchemaAvailabilityStatus;
  readonly reasonSha256: string | null;
  readonly recordedAt: CanonicalIsoInstant;
}

interface FrameworkSchemaAvailability {
  readonly history: FrameworkSchemaAvailabilityHistory;
  readonly token: FrameworkSchemaAvailabilityToken;
}
```

Readiness receipts are immutable validation evidence. A separate immutable
availability history plus one CAS head records whether the installation may
still serve. `installing` is migration-attempt state and cannot masquerade as
availability. A binding captures the exact readiness digest and availability
token. If either changes or cannot be authenticated, runtime admission fails
closed until a new compatible binding set activates.

Each availability-history frame commits to the installation identity,
availability sequence, prior head token, new status, reason/evidence digest,
and database time. The head commits to the exact history entry. History is
never edited, and a status change is not encoded by mutating an installation or
readiness receipt.

`quarantined` is a valid authenticated operator transition whose history and
evidence decode correctly. It prevents serving. It is distinct from
`storedStateCorrupt`, which means bytes, constraints, or linked evidence could
not be authenticated and therefore cannot be normalized into any valid status.

A readiness evaluation returns a domain result with a stable reason union:

```ts
type FrameworkSchemaReadinessNotReadyReason =
  | "installationMissing"
  | "installationInProgress"
  | "validationMissing"
  | "structureMismatch"
  | "capabilityMissing";

type FrameworkSchemaReadiness =
  | { readonly status: "ready"; readonly receipt: FrameworkSchemaReadinessReceipt }
  | {
      readonly status: "not_ready";
      readonly reason: FrameworkSchemaReadinessNotReadyReason;
      readonly detail?: string;
    };
```

Expected incompleteness is not an exception and not `Option`. Corrupt stored
evidence, foreign resource failure, or violated invariants remain failures.

### Framework binding

```ts
interface FrameworkSchemaBinding {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly artifact: FrameworkSchemaArtifactIdentity;
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly readinessSha256: string;
  readonly availability: FrameworkSchemaAvailabilityToken;
  readonly requiredCapabilities: readonly FrameworkSchemaCapabilityId[];
}
```

The artifact, installation, and binding deployment, owner, lineage, and
physical locator must agree exactly. The binding authority pins must match its
containing `DataBindingSet`. Capabilities obey the strict chain
`required ⊆ validated ⊆ installed ⊆ artifact-declared`; no receipt or
binding may manufacture a capability absent from desired state.
The binding contains no database handle, repository, callback, framework
service, or structurally forgeable transaction capability.

## Read-Only Application Bridge

`ApplicationDataBindingReference` is constructed only from one coherent active
Application read under the current located scope authority. It is a detached,
canonical scalar projection, not an alias of an internal row or nominal
capability.

Its later value shape contains this exact field set:

```ts
interface ApplicationDataBindingReferenceBase {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly activeHead: ApplicationActiveCasToken;
  readonly activationSha256: string;
  readonly readinessSha256: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly publicationSha256: string;
  readonly functionCatalogSha256: string;
  readonly taskCatalogSha256: string;
  readonly taskCatalogBindingSha256: string;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly applicationSchemaSha256: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256: string;
  readonly referenceSha256: string;
}

type ApplicationDataBindingReference =
  | ApplicationDataBindingReferenceBase & {
      readonly kind: "relation_free";
      readonly schemaBindingSha256: string;
    }
  | ApplicationDataBindingReferenceBase & {
      readonly kind: "relation_bearing";
      readonly manifestSchemaBindingSha256: string;
      readonly boundPublicationSha256: string;
      readonly relationSetReadinessSha256: string;
      readonly relationCount: number;
      readonly relationFrontierCommitSeq: string;
    };
```

The union discriminant is `"relation_free" | "relation_bearing"`. The bridge
captures hashes and scalar identities only; it does not persist the manifest,
relation-definition set, database target, or `ApplicationActiveSelection`.

Only the Application activation owner may later issue this projection. The
future operation belongs beside `ApplicationActivation.readActive`, where the
full validated readiness basis and coherent head are simultaneously available,
before the nominal selection hides that basis. The lower-level coherent-head
and revision readers do not expose the full source, publication, task, runtime,
and binding evidence and are insufficient on their own.

Framework activation needs the Application owner to expose that proof as a
transaction-scoped operation over the caller's already located target
transaction. Calling the ordinary `readActive` facade in a separate transaction
would not establish the CAS precondition for framework activation and is
forbidden.

That issuer is checkpoint 5, not part of the artifact value slice.
Independently reading and combining a head, schema binding, and readiness row
is forbidden. A structural object supplied by a framework adapter is inert and
cannot claim this authority.

Application activation can make a stored framework binding stale. That does
not roll the Application head back and does not select another framework set.
Framework admission simply fails closed until an operator activates a new
`DataBindingSet` referencing the new coherent Application head.

## Payload Content Overlay

`PayloadContentOverlay` is independently digestible policy and compatibility
evidence. Its later value shape is:

```ts
interface PayloadContentTableBinding {
  readonly tableId: CatalogTableId;
  readonly applicationWritePolicySha256: string;
}

interface PayloadContentOverlay {
  readonly applicationReferenceSha256: string;
  readonly configurationProvenanceSha256: string;
  readonly payloadPolicyId: string;
  readonly tables: readonly PayloadContentTableBinding[];
  readonly overlaySha256: string;
}
```

Tables are sorted by stable numeric table ID and duplicates are rejected. The
exact per-table policy commitment participates in that order.

The configuration/provenance digest excludes the later Application reference
and every digest derived from it, preventing a digest cycle. The future
Application-owner write-policy preflight must first make the policy ID and
configuration digest part of authenticated Application schema evidence. Until
then no writable Payload content overlay may activate.

The overlay has no artifact installation, readiness receipt, or independent
content-schema head. A separate `payloadLifecycle` binding exists only when an
admitted Payload lifecycle artifact owns real physical structures.

## DataBindingSet

The first binding contract, after its frame preflight, uses named slots rather
than an open owner map:

```ts
interface DataBindingSet {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly application: ApplicationDataBindingReference;
  readonly payloadContent: PayloadContentOverlay | null;
  readonly payloadLifecycle: FrameworkSchemaBinding | null;
  readonly commerce: FrameworkSchemaBinding | null;
  readonly crossDomainReferences: readonly [];
  readonly bindingSetSha256: string;
}
```

The fixed slots enforce these rules:

- `payloadLifecycle`, when present, has owner `"payload"`;
- `commerce`, when present, has owner `"medusa"`;
- the Application member can never be supplied as a generic framework binding;
- a system artifact receives no generic bag entry; a future use must define a
  named system slot and its semantics in a separate preflight;
- every member matches the set's deployment, physical locator, generation,
  fence, and epoch;
- the initial cross-domain-reference collection is exactly empty; roadmap 05
  may replace it with a typed value only through a separate persisted-codec and
  compatibility preflight; and
- members participate in the canonical set digest with explicit `null` for
  absent optional slots and sorted arrays.

`DataBindingSet` is immutable desired selection data, not runtime authority.
The later resolver may issue a WeakMap-backed or equivalently opaque active
selection capability after authenticating the active framework head and every
member. That capability is process-local, non-serializable, and must be
revalidated in the accepting transaction.

Likewise, pure artifact capture now, and any later installation, readiness,
overlay, binding, or set capture, produces inert canonical values only. It
cannot mint admission, installation, readiness, or serving authority. Later
repositories authenticate stored evidence and issue narrow opaque capabilities;
they never trust a structural value merely because it satisfies one of these
interfaces.

## Activation And Transaction Rules

The later persistence slice will use immutable binding-set candidates and
activation history plus one scope-local framework binding head. That head is
separate from and subordinate to the Application head. Its CAS has the same
minimal semantics but deliberately distinct branded fields, preventing
structural substitution with `ApplicationActiveCasToken`:

```ts
type DataBindingSetActivationSequence =
  Brand.Branded<bigint, "FlarexDB/DataBindingSetActivationSequence">;
type DataBindingSetHeadSha256 =
  Brand.Branded<string, "FlarexDB/DataBindingSetHeadSha256">;

interface DataBindingSetActiveCasToken {
  readonly dataBindingSetActivationSequence: DataBindingSetActivationSequence;
  readonly dataBindingSetHeadSha256: DataBindingSetHeadSha256;
}
```

Activation first authenticates deployment, scope, and physical locator through
the existing trusted located-authority resolution. It then runs one transaction
against that exact target. The target scope-clock row does not contain
deployment or locator, so this preflight does not pretend to re-read them from
that row. The mandatory transaction lock and validation order is:

1. lock the scope clock for update and revalidate scope, storage generation,
   fence, and epoch against the already located authority;
2. read and authenticate the current Application head and coherent projection,
   requiring the exact Application CAS precondition;
3. lock each referenced installation availability head in canonical identity
   order and authenticate the target-local installation/readiness commitment
   to the exact artifact identity, plus status and capability commitments;
4. validate Payload policy evidence, named slot ownership, physical
   colocation, and every cross-domain compatibility edge;
5. lock the framework binding head and require the caller's expected prior
   framework CAS token;
6. insert immutable activation history; and
7. compare-and-set the one framework binding head.

Current Application activation also starts with the scope-clock authority, so
Application and framework activations for one scope serialize without either
owner writing the other's head. Installation withdrawal or quarantine takes
the corresponding availability-head lock for update; framework binding
activation uses the modes in the numbered sequence above.

Serving admission lock modes are intentionally gated on the transaction-scoped
Application-bridge and repository preflight. That preflight must choose the
complete lock plan for each read-only or mutating operation class before the
transaction opens, and it must prove both current Application variants. A lock
acquired in share mode may never be upgraded to update mode inside the
transaction; an operation that needs the stronger mode must select it up front
or restart in a new transaction. Until that proof exists, this record makes no
deadlock-freedom or serving-performance claim and authorizes no serving path.

Every serving attempt first resolves `LocatedTrustedScopeAuthority` through the
trusted resolver. That resolved physical target alone selects the database.
Only then may the resolver read the framework head on that exact target as a
non-authoritative hint to discover member identities; neither a hinted binding
nor its embedded `physicalLocator` may select or redirect the target. It retains
no head lock from the hint read. Inside the accepting transaction, the chosen
up-front lock plan follows the invariant order: scope clock, exact Application
head, hinted availability heads in canonical order, then framework-head lock
and re-read. Any hint/head mismatch restarts the bounded resolution from the
beginning or fails closed; it never continues on mixed evidence. The scope,
Application, availability, and framework-head protection is retained through
the accepting data operation.

Control-plane artifact bytes may live separately from a scope's target
database. That never creates a distributed transaction. An installer or
activation planner can authenticate a control artifact before target work, but
binding activation authenticates only the target-local installation/readiness
commitment to that exact artifact identity and revalidates target authority
inside its transaction. It does not claim a transactionally current read of the
separate control registry.

Only physically colocated lane bindings can participate in one atomic common
data commit. A `DataBindingSet` cannot turn multiple databases into a
transaction. Non-colocated references are read-only or use an explicitly
designed asynchronous protocol; they cannot be declared atomic.

If Application head, scope authority, readiness, or availability no longer
matches, framework lanes fail closed. There is no automatic fallback to a
previous binding set. Rollback is a new activation of a retained compatible
set against the then-current exact Application reference, never mutation of
history.

## Typed Failure Contract

The private domain uses three tagged error owners. Each error carries
`operation`, `reason`, a stable human message, a policy-derived `retryable`
flag, and an optional preserved cause only at a boundary that owns that foreign
failure.

Checkpoint 1 implements only the `"capture"` and `"classifyReplay"` branches of
`FrameworkSchemaArtifactError`. Capture admits `invalidInput`,
`ownerNotAdmitted`, and a narrowly mapped `resourceFailure`; replay
classification admits only `digestCollision`. The artifact envelope validates
codec field shape and limits but does not claim to understand an owner codec;
`unsupportedCodec` belongs to a later owner consumer or repository. Repository
operations/reasons and the other two error owners remain part of their later
preflights; listing their target vocabulary here does not create empty services
or speculative callers.

### `FrameworkSchemaArtifactError`

Operations: `"capture" | "classifyReplay" | "admit" | "read"`.

Reasons:

- `"invalidInput"`;
- `"ownerNotAdmitted"`;
- `"unsupportedCodec"`;
- `"dependencyMissing"`;
- `"digestCollision"`;
- `"storedStateCorrupt"`; and
- `"resourceFailure"`.

### `FrameworkSchemaInstallationError`

Operations: `"capture" | "install" | "readReadiness" | "changeAvailability"`.

Reasons:

- `"invalidInput"`;
- `"wrongOwner"`;
- `"artifactMissing"`;
- `"locatorMismatch"`;
- `"migrationPlanMismatch"`;
- `"validationMissing"`;
- `"withdrawn"`;
- `"superseded"`;
- `"quarantined"`;
- `"requiredCapabilityMissing"`;
- `"decisionUncertain"`;
- `"storedStateCorrupt"`; and
- `"resourceFailure"`.

### `DataBindingSetError`

Operations: `"capture" | "resolve" | "activate"`.

Reasons:

- `"invalidInput"`;
- `"wrongOwner"`;
- `"bindingMissing"`;
- `"artifactMissing"`;
- `"installationMissing"`;
- `"installationNotReady"`;
- `"requiredCapabilityMissing"`;
- `"staleReadiness"`;
- `"scopeAuthorityChanged"`;
- `"applicationHeadChanged"`;
- `"expectedBindingChanged"`;
- `"crossDomainIncompatible"`;
- `"notColocated"`;
- `"decisionUncertain"`;
- `"storedStateCorrupt"`; and
- `"resourceFailure"`.

Expected `not_ready` evaluation remains a readiness result until an operation
that requires serving converts it to `installationNotReady`. Validation and
authorization failures are not retryable. A narrowly classified transient
resource failure may be retryable only around an idempotent operation with the
same captured input. `decisionUncertain` requires authoritative lookup, not
blind replay.

Operations preserve already typed scope, Application, and component errors in
their Effect error unions instead of repeatedly wrapping them. Unexpected
programming defects, impossible decoder states, and invariant failures remain
defects. Broad `catchAll`, unknown-to-domain coercion, and error-channel erasure
are forbidden.

## Package And Effect Ownership

The first code checkpoint belongs privately under:

```text
packages/persistence-postgres/src/frameworkSchema/artifact/
  model.ts
  policy.ts
  canonical.ts
  errors.ts
```

Focused tests may import those internal modules directly. There is no package
root export and no new workspace package. `@flarex/managed-schema` remains the
Application owner. `@flarex/utils` remains a dependency leaf and does not gain
schema policy, codecs, errors, hashing, persistence, or framework semantics.

The implementation rules are:

- pure artifact normalization, comparison, and canonical-frame assembly use
  `Result`;
- SHA-256 uses a narrow asynchronous Effect adapter over Web Crypto and maps
  only expected foreign failures while preserving defects;
- later artifact, installation, readiness, availability, binding, and
  activation repositories expose `Effect` operations with explicit typed
  failures;
- dynamic located targets and transaction capabilities remain scoped opaque
  values, not singleton `Context` services;
- a later orchestration service may use `Context.Service` and an inert `Layer`
  only after real repository consumers exist;
- Layer construction never migrates, installs, validates, or activates; and
- Promise facades exist only at actual Payload or Medusa host boundaries and
  use one lifecycle-owned runtime, never ad hoc `runPromise` inside core.

The hashing adapter always calls `crypto.subtle.digest` with the literal
algorithm `"SHA-256"`; the algorithm is not caller input. Absence or failed
acquisition of Web Crypto, a synchronous throw from that call, or rejection of
its promise becomes `FrameworkSchemaArtifactError` with operation `"capture"`,
reason `"resourceFailure"`, message
`"Framework schema artifact SHA-256 failed"`, `retryable: false`, and the
foreign cause preserved. The common core does not retry it. A fulfilled value
that is not an `ArrayBuffer` of exactly 32 bytes is an impossible platform
result and remains a defect. Failure of the protocol canonical encoder or
`TextEncoder` after successful normalization is likewise an invariant defect,
not a typed input or resource failure. Neither canonical text nor owner payload
is attached to the error or logs.

The package dependency direction remains:

```text
flarex-protocol + @flarex/utils + @flarex/time + effect
                            |
                            v
@flarex/persistence-postgres private frameworkSchema domain
                            |
                            v
later application-registration orchestration and framework adapters
```

Payload and Medusa packages do not become dependencies of the common domain.
Portable extraction is considered only after two real consumers prove an exact
shared contract.

## Persistence Decision

The first pure contract checkpoint requires **no migration**. A later
repository/DDL preflight must design only additive storage families:

1. an immutable owner-qualified artifact registry in the control authority;
2. target-local installation receipts, readiness receipts, availability
   history, and one availability head per installation;
3. target-local immutable `DataBindingSet` candidates and activation history;
   and
4. one target-local framework binding head per scope.

Application data is projected read-only from its current rows. Do not add an
Application row to the generic artifact registry, duplicate its readiness, or
dual-write its activation. Do not alter `fx_control_schema_version`, bound
Application schema rows, Application readiness rows, or
`fx_system_application_active_head` in this work.

The stable table catalog may later supply physical table IDs after the
relational-schema preflight proves the mapping. Its namespace column remains a
catalog classification, not the artifact owner key. Exact table names, keys,
foreign keys, and migration order for the new storage are intentionally owned
by the later repository/DDL preflight.

## Evidence Matrix

### Next private contract checkpoint

The implementation cannot exit until focused tests prove:

- owner, lineage, codec, provenance, capabilities, dependencies, and payload
  all participate in the artifact digest;
- identical owner payloads under different owners or lineages have different
  identities;
- exact canonical replay is idempotent, while the same digest with different
  canonical text is classified as a collision by the pure replay policy;
- limits, malformed codec fields, excess or computed input fields, accessor
  containers, unpaired surrogates, duplicates, and self-lineage dependency fail
  deterministically;
- unsorted capabilities and dependencies normalize to the same canonical frame
  and digest as their already sorted equivalents;
- dependencies from another deployment or semantic owner fail, and the exact
  UTF-8/owner-ordinal comparator is deterministic;
- depth and node ceilings follow the specified root, occurrence, and traversal
  accounting, including repeated acyclic containers and cycle rejection;
- input JSON and arrays are detached and runtime-owned after capture;
- every expected Web Crypto failure maps to the one non-retryable typed resource
  failure, while invalid fulfilled digest results and encoder invariants remain
  defects;
- digest, lineage, capability, codec-format, codec-version, and canonical-text
  brands cannot be structurally interchanged in type tests;
- no package-root export or Payload/Medusa dependency appears; and
- current Application tests observe no changed caller or behavior.

No database claim is made by those tests. They do not claim dependency
existence, artifact admission, an installation, readiness, an Application
projection, or an active binding.

### Checkpoint 1 implementation receipt

Checkpoint 1 is complete privately and production-inert on 2026-08-30:

- `model.ts`, `errors.ts`, `policy.ts`, and `canonical.ts` implement only the
  artifact value, normalization, complete identity comparator, replay policy,
  canonical-byte ceiling, and Web Crypto SHA-256 boundary;
- the private module has no package-root or export-map entry and no Payload,
  Medusa, database, migration, repository, routing, or runtime caller;
- one focused test file passes 19 tests covering the golden frame and digest,
  exact inclusive budgets, descriptor and proxy hostility, detachment and
  freezing, UTF-8 and UTF-16 ordering, replay collision, Web Crypto failures,
  and invariant defects;
- `@flarex/persistence-postgres` typecheck, `lint:core`, `lint:diff`, and the
  unchanged `applicationSchemaAuthority.test.ts` lane pass; and
- both standing TypeScript/Effect and code-quality reviews report no findings.

No PostgreSQL lane is required or claimed because this checkpoint contains no
storage. The broader `schemaVersionArtifacts.test.ts` lane currently has two
standalone defect-classification failures in its unchanged owner, and the
workspace Effect-boundary audit reports four unchanged executor Promise
bridges. Neither owner is imported or modified by this checkpoint, so those
baseline failures are recorded but not repaired here.

### Later installation and binding contract evidence

Before their value contracts can be implemented, their frame preflights must
freeze exact digest preimages, exclusions, brands, bounds, comparators, and
canonical instant handling. Focused tests must then prove:

- `required ⊆ validated ⊆ installed ⊆ artifact-declared`;
- every embedded physical locator is captured through
  `captureScopePhysicalLocator`, detached, and immune to caller mutation;
- database times enter value frames only as owned `CanonicalIsoInstant` values;
- optional binding slots encode as explicit `null`, and the initial
  cross-domain-reference collection is exactly empty;
- wrong-owner slot substitution and Application-as-framework-binding fail;
- a Payload content overlay has no installation and cannot form a digest cycle;
- Application-reference frames contain no nominal capability; and
- checkpoint 5's Application-owned issuer, not the pure value codec, proves
  that a live reference came from one coherent current head/readiness/schema
  basis.

### PGlite evidence split

The separately gated artifact repository now has PGlite evidence for its
migration, constraints, replay/conflict behavior, rollback, corrupt-row
rejection, and cold reopen claims. PGlite may later prove corresponding
installation and availability behavior plus broad Application regression. It
does not prove lock or concurrency semantics.

### Genuine-PostgreSQL evidence split

The artifact repository preflight separately records its completed ordinary-
role genuine-PostgreSQL evidence. Genuine PostgreSQL remains mandatory for the
later installation and binding claims, including:

- concurrent installation convergence and its interaction with immutable
  artifact identity;
- owner and lineage isolation under contention;
- Application-head movement racing framework activation;
- availability withdrawal racing activation and serving admission;
- scope-clock, installation-head, and binding-head lock order and deadlock
  evidence;
- migration lease, rollback, and uncertain-settlement behavior;
- target/control split recovery; and
- proof that stale generation, epoch, readiness, or availability can never
  serve.

This identity record does not itself claim those later receipts.

## Ordered Implementation Checkpoints

1. **Private artifact value contract — complete:** artifact models, canonical
   capture, digest/replay policy, capture errors, brands, and focused tests are
   implemented privately with no storage or caller.
2. **Private artifact repository/DDL — complete:**
   [`02-artifact-repository-and-ddl.md`](./02-artifact-repository-and-ddl.md)
   freezes and implements the additive artifact tables, exact keys, dependency
   admission, corruption rules, migration compatibility, private repository,
   control-session behavior, and focused PGlite plus genuine-PostgreSQL
   acceptance without an Application writer or runtime caller.
3. **Consumer-informed relational constraint gate — next:** complete the exact
   Medusa source/capability map and Payload contract preflight, then implement
   the private value-only `RelationalSchema` as ordered by
   [`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).
4. **Installation/readiness/availability frame and repository preflights:**
   proceed only after the relational-schema and migration-coordinator
   preflights constrain plan and structure evidence.
5. **Application projection and DataBindingSet frame/repository preflight:**
   freeze every remaining codec, add the Application-owned coherent bridge,
   then design target-local candidates/history/head and activation proof.
6. **Framework adapter use:** only after the corresponding Medusa or Payload
   conformance gate explicitly authorizes a private consumer.

Each checkpoint is separately reviewable and production-inert. A later item
does not become authorized merely because this preflight is accepted.

## Exit Decision

The architecture preflight, private artifact-value checkpoint, and separately
gated private artifact repository/DDL checkpoint are complete. They resolve the
owner collision, preserve the one existing Application authority, and
distinguish desired artifacts from physical proof, current availability, and
subordinate framework selection. The repository implementation and its focused
PGlite plus genuine-PostgreSQL acceptance are owned by
[`02-artifact-repository-and-ddl.md`](./02-artifact-repository-and-ddl.md).
Work may proceed only through the consumer-informed constraint and value-only
`RelationalSchema` sequence; all later lifecycle, adapter, runtime, public, and
production gates remain closed until their own preflights pass.
