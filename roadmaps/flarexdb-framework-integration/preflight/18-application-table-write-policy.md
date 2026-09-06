# Application Table Write-Policy Admission

## Status And Coherent Outcome

Status: private Application-owner denial capability implemented and reviewed;
PGlite and native PostgreSQL preservation pass.
This is the concrete write-policy prerequisite of the
[CMS request/publication proposal](./17-cms-request-transactions-and-application-publication.md).
It closes the policy decision in one capability, without another preliminary
value-only or storage-only approval gate.

The private source producer, Manifest V3 analysis, durable binding/publication,
readiness and activation now preserve canonical `writePolicies` evidence and
`writePolicySetSha256`. Activation installs authenticated retained ownership in
the existing target transaction. Private generated-authoring types omit managed
table writers; the journal returns recoverable pre-append denials, and the
authoritative commit kernel independently checks authenticated attempted tables
before generation dispatch and net-zero row coalescing can bypass ownership.
Existing V1/V2 encoded contracts retain their exact shapes.

The first executable outcome is an authenticated Application containing one
new scalar CMS-managed table and an ordinary Application-owned table. Analysis,
publication, readiness and activation preserve their exact ownership. Application
reads and app-owned mutations continue to work. Every ordinary mutation path
rejects the CMS-managed table, including a forged journal and an old admission.
Payload writes remain unavailable until the CMS host and content binding pass
their own implementation and conformance gates.

This capability changes Application artifact, readiness/activation, authoring
types and commit admission. It does not implement a Payload adapter, authorize
CMS publication, transfer an existing app-writable table, add privileged repair
APIs, change row storage, or replace Application OCC and result replay.

## Source Findings And Design Challenge

The accepted [write-authority decision](../../../design-notes/flarex-db-accepted-design.md)
and [Payload adoption contract](../07-payload-adoption.md#application-write-policy-admission-preflight)
require Application-owned policy before an editable CMS overlay exists.

| Current source | Consequence |
| --- | --- |
| [Application schema definitions](../../../packages/application-schema-definition/src/ApplicationSchema.ts) carry validators/indexes; [Manifest V2](../../../packages/analysis/src/applicationAnalysisV2.ts) adds relations but strictly accepts no policy field. | Add an authenticated policy-bearing Application contract; an adapter table-name denylist or unknown field ignored by analysis cannot enforce ownership. |
| [Schema publication frames](../../../packages/analysis/src/applicationPublicationFramesV2.ts) commit the Application schema. | Policy must affect canonical Application schema/publication identity, not mutable UI metadata. |
| [Payload content binding](../../../packages/persistence-postgres/src/frameworkSchema/binding/model.ts) already names per-table `writePolicySha256`; [binding evidence](../../../packages/persistence-postgres/src/frameworkSchema/binding/evidence.ts) rejects Payload profiles. | A digest-shaped value is not an issuer. Keep Payload admission closed while implementing Application denial and authenticated evidence. |
| [Application mutation admission](../../../packages/persistence-postgres/src/applicationMutationAdmission.ts) selects function/schema authority; the [point commit kernel](../../../packages/persistence-postgres/src/pointCommitTransaction.ts) independently validates and lowers row intents under the scope clock. | Reject early for normal callers and decisively again on the actual write transaction. A trusted admission object alone cannot protect an escaped or forged journal. |
| The point commit kernel treats `application_v1` and `legacy_dynamic_worker_v1` differently during active-schema validation. | Put the ownership backstop before generation-specific early returns. Do not assume all physical Application-row writes came through the new Application facade. |
| [Activation](../../../packages/persistence-postgres/src/applicationActivation.ts) atomically persists target history/head from exact readiness. | Install and retain ownership claims in that same transaction; an overlay activated later must never be the event that first removes Application write permission. |

Rejected alternatives are an adapter-local allowlist, policy stored only in
`DataBindingSet`, a boolean supplied by the mutation caller, and a second CMS
row store. All either leave a direct-write bypass or duplicate Application
authority. Checking only the final active table declaration is also insufficient:
an older revision could omit the policy or reuse the same stable table identity.

Recommended direction: authenticated immutable table declarations plus a
target-side activation projection that retains established managed ownership.
The projection is verified against immutable policy/activation evidence; it is
not an independently editable policy authority.

## Independent Configuration And Policy Values

Define a strict canonical `flarex.payload-configuration` frame, version 1,
containing the registered scalar profile, pinned provenance identity and the
supported declarative configuration over stable logical table names. Reject
unknown fields, duplicate identities, accessors, executable functions and
unsupported configuration. Reuse the exact release/provenance evidence and
sanitized-config constraints from the [Payload audit](./07-payload-release-and-adapter-contract.md).
The private conformance fixture may use a registered fixed configuration; it
does not import or activate Payload.

Its digest must not contain any later Application manifest, schema version,
readiness, active head, physical placement, catalog table ID or content-overlay
digest. Provenance is likewise independently canonical and digestible. This
keeps the dependency graph acyclic:

```text
Payload configuration + provenance
  -> Application logical table policy
  -> canonical Application schema/publication
  -> bound catalog identities + readiness + activation
  -> exact Payload content overlay (later CMS host capability)
```

The policy declaration has exactly one entry for each Application logical table:

- `application`: ordinary Application mutation authority, with no Payload fields.
- `payload`: stable registered `policyId`, `configSha256` and
  `provenanceSha256`; this mode denies ordinary Application mutations.

Use `payload.scalar` as the first registered policy ID. The policy ID identifies
the accepted semantics, not an arbitrary caller-selected issuer. The referenced
configuration must name the exact logical table and supported profile. A CMS
view or app-command-managed presentation remains `application` here; those
presentation choices do not grant a new physical writer.

Each table's `writePolicySha256` hashes a strict version-1
`flarex.application-table-write-policy` frame containing its logical table
identity and complete declaration. The canonical policy set sorts by the
existing logical identity ordering, has no duplicates and exactly covers the
schema tables. Application analysis verifies the configuration/provenance
references against owned canonical evidence rather than trusting a hash string.
Catalog IDs enter only in the later bound publication and activation projection.

The first policy-bearing profile admits at most 64 tables and 64 retained managed
claims per scope, with at most 1 MiB of canonical configuration and policy
evidence, subject to stricter existing Application frame limits. Check counts,
bytes and depth before retaining values; resource refusal cannot drop policies
or interpret an incomplete set as Application-owned.

Historical verification and ownership restoration have separate limits: at most
64 publication/activation/claim records or predecessor nodes examined per
admission, and at most 1 MiB aggregate canonical historical evidence. Count
across stores and phases; paging or cached preparation cannot reset the budget.
Prefer an existing indexed authoritative proof for stable table identity. If
history traversal is needed, use bounded reads and fail closed when complete
newness or predecessor correlation cannot be proven within these limits. Never
equate the end of a budgeted page with absence from all history. Keep preparation
outside the scope write lock where possible and revalidate its exact publication,
activation and fence anchors on the actual activation transaction.

## Artifact And Compatibility Cutline

Use a distinct policy-bearing `ApplicationManifestV3` with schema version 3.
Its schema contains existing tables, indexes and relations plus required
`writePolicies` and `writePolicySetSha256`. The schema publication and readiness commitments must include
the complete policy-set digest. Do not change V1/V2 canonical bytes, add optional
permission fields to their strict decoders, or strip V3 into V2 for an old
consumer. Empty relation declarations are valid in the scalar V3 fixture.

The suffix identifies a different encoded authority contract, not a new name for
an implementation iteration. Share canonical validators, relation analysis and
publication mechanics; do not copy the entire analysis or persistence engine.
Existing non-policy producers and their intended Application behavior stay in
scope as regression inputs. Their presence is not evidence of deployed data or
a reason to build dual storage, backfills or an old/new runtime switch. None is
proposed by this capability.

Add a policy-aware readiness variant and an explicit policy-aware Application
binding-reference variant. They commit the exact manifest/schema binding,
native relation readiness (including the zero-relation case), policy set and
retained ownership claims. Existing reference variants keep their current
encoding; old readers reject the new variant. Every unsupported consumer must
refuse it rather than downgrade or construct a policy-free projection.

Generated/private authoring types expose ordinary mutation operations only for
`application` tables; read capabilities remain separately governed. Carry the
policy through Standard definition preparation and trusted analysis. Do not add
public `.cms()` or `ctx.cms` syntax. Dynamic table selection and casts cannot
weaken runtime checks. No special CMS API is added to the legacy runtime.

## Binding, Readiness And Durable Ownership

Application publication binds logical policies to its exact catalog table IDs.
Readiness verifies canonical bytes/digests, complete table coverage, owner/profile
agreement and all current schema/index/unique/relation prerequisites. The policy
does not replace candidate-schema validation or native relation readiness.

Policy activation first holds the control deployment row used by schema
publishers, then takes the existing target scope-clock write lock. Under these
locks, the target transaction must atomically:

1. validate the exact policy-aware readiness and expected active-head CAS;
2. verify retained managed ownership against authenticated prior activation;
3. prove each newly managed table has never been app-writable under a prior
   admitted publication for that stable identity;
4. append the activation-owned claims/projection, including its canonical
   identity, complete set digest and predecessor correlation; and
5. persist the corresponding activation history and active head.

Use target-side immutable claim evidence plus one current projection per scope,
in the Application domain. The claim binds scope/generation, stable catalog
table identity, policy/configuration/provenance digest and establishing
activation. The active head/readiness correlation authenticates the exact
projection. A missing, partial, copied or corrupt projection for a policy-aware
head is a typed refusal, never an empty policy set.

Read historical publication/activation evidence through owned repositories;
do not accept a caller's `newTable` flag. Check stable catalog identity, not just
the latest logical name. A previously app-writable table cannot become managed
merely because it was dropped, renamed or omitted from the immediately prior
revision. Concurrent activation and publication attempts must not evade this
check. If newness cannot be established from authoritative evidence, refuse.

Managed claims are immutable and retained for the scope lifetime in this first
capability. Later revisions cannot remove them, relabel their table as
Application-owned, replace their policy/configuration/provenance identity or
reuse the identity under another owner. A policy-bearing scope cannot activate
a V1/V2 head. Failed activation changes neither claims nor the old active head.
Policy changes, ownership transfer and general managed-table retirement require
their own future semantics; this capability does not invent them.

The first proof uses a fresh managed table alongside retained app-owned tables.
Application activation establishes the deny rule while the Payload overlay is
absent. Withdrawing, losing or failing to activate that overlay never restores
ordinary write permission. Application reads do not depend on a writable CMS
overlay and retain their current access/snapshot checks.

This is a private current-host capability. No rolling deployment with older
writers or binary downgrade is admitted for a policy-bearing scope. All enabled
write entrypoints must use the enforcing composition before such activation;
fresh conformance fixtures prove this boundary. Existing generation/fence and
revocation checks remain mandatory, but are not a claim that an old binary
which ignores policy can safely mint new authority.

## Every Write Path And One Decisive Backstop

Normal Application invocation checks policy when a logical mutation targets a
table, before adding its write to the journal. This provides a useful typed
`writePolicyDenied` failure and prevents unsupported generated operations.
Apply it to insert, replacement, patch and deletion, including internal mutation
calls and task/action callbacks when they enter Application mutation authority.
Mutation-internal queries remain read-only. Read-only entrypoints
must not be turned into policy writers or acquire a new write permission.

Preserve Application's existing catch semantics: a policy error raised before
journal append may be caught, and later authorized app-owned work may still
complete. The rejected call contributes no write. Do not import the CMS host's
rollback-only-on-any-nested-failure rule into Application execution. Conversely,
an authenticated journal that actually contains a managed write attempt is
rejected as a whole at authoritative admission, even if its final row effect
was coalesced away.

The authoritative commit transaction independently resolves policy after locking
the scope clock and revalidating the relevant active authority. It checks the
complete materialized write set and any operation evidence needed to account for
attempted managed writes before any row, index, unique-key or relation mutation.
An early SDK/runtime check or a final net-zero result does not substitute for
this verification. The current [point planner](../../../packages/executor/src/storedAttemptAuthentication/pointCommitPlanning.ts)
coalesces verified point state into final row intents, so those intents alone
cannot prove which tables were targeted. The trusted stored-attempt verifier
must retain the distinct attempted table identities from the authenticated
journal before coalescing, bound to its exact scope/session/attempt, journal
seal and canonical evidence. Carry that through an owned planning capability;
never accept a caller-authored touched-table array. The transaction checks its
correlation with the locked journal root and current policy. Missing attempt
evidence on a policy-bearing write fails closed; no new durable journal is needed.
Define one Application-owned operation for this check and
invoke it from each authoritative publication/rollback-proof entrypoint.

The guard precedes the point kernel's generation-specific branch. Legacy
dynamic-worker admission is rejected for a policy-bearing scope; it cannot
bypass the policy by supplying a schema ID. New Application commands may still
write the explicitly app-owned tables after current authority validation.
Do not route successful result replay through a new mutation: retain the exact
identity/access and retention-aware outcome validation without reexecuting the
command or reauthorizing a historical write as fresh work.

At materialization, a future CMS issuer must supply an opaque capability tied to
the same transaction, exact policy-aware active head, owner/configuration,
table set and content binding. This capability adds no issuer to ordinary
Application callers. The first write-policy slice has no CMS success branch:
direct adapter calls, caller-authored policies and copied/foreign capabilities
remain denied. The CMS host proposal owns positive issuance and one publication.

Low-level row append helpers stay persistence-internal; they do not become
developer APIs. Their current production owner is the point commit kernel.
Inventory every new direct caller before granting policy-bearing scope access.
Privileged migrations, imports, repairs and backfills need separately registered
owner capabilities and native invariants; absence of a CMS overlay is not their
authorization. Existing isolated fixtures do not create a production bypass.

Preserve scope-first lock ordering, rollback, OCC retry classification, result
identity and commit/fact/outbox ordering. A policy refusal is not an OCC conflict
and cannot be fixed by silently retrying the same unauthorized write. Keep the
exact internal failure cause behind the owning invocation/adapter projection.

## First Implementation And Proof

Implement the complete private denial vertical in one capability: canonical
configuration/policy values, policy-aware Application analysis and publication,
readiness/activation projection, authoring restrictions and authoritative write
denial. Include the schema migration needed by the owned target metadata and
prove its actual baseline; do not add unrelated durable receipt or result tables.

| Area | Disposition |
| --- | --- |
| Existing table/validator/index/relation semantics | Keep and share; add policy composition without another schema authority. |
| Canonical Application and activation/readiness dispatch | Extend with a strict explicit policy contract; never silently reinterpret older frames. |
| Point commit kernel and normal mutation admission | Port the smallest connected path to the common Application policy guard; keep publication and OCC behavior. |
| Existing non-policy Application paths | Keep behavior and proof coverage; do not invent shipped compatibility obligations or add CMS features to legacy execution. |
| Payload content issuer and transaction host | Remain closed until the separately proposed CMS capability; no successful stub or autocommit fallback. |
| Adapter-local denylist, caller boolean, dual row engine | Do not introduce. |

Pure tests cover strict capture, canonical digest dependency direction, exact
coverage, malformed/unknown policy, forged references and resource bounds.
Type tests prove managed tables lack ordinary mutation methods while reads and
app-owned writes remain usable. Existing Application errors and result types
retain their intended contracts.

One shared end-to-end scenario per driver must prove:

- Newly managed plus app-owned table publication/readiness/activation, with no
  Payload overlay and ordinary reads still valid.
- Application insert/replace/patch/delete denial, nested/internal/callback
  reachability, malformed or forged journal refusal and net-zero attempt denial.
- App-owned success, exact replay and OCC conflict behavior alongside the managed
  table. Uncaught denial or commit-time refusal leaves no rows, history, derived
  state, facts or wakes; catching a pre-append denial may permit later app-owned
  publication but never a managed-table change.
- Failure between claim installation and head movement, stale admission,
  missing/corrupt policy evidence, restart recovery and replayed activation.
- Refusal of older-head activation, owner downgrade, changed config/provenance,
  reusing a historically app-owned identity and removing a managed claim.
- Exact-limit and over-limit historical verification/restoration, including a
  reused identity beyond the first page; over-budget refusal changes no claim
  or head and never grants ownership based on a partial scan.
- Native PostgreSQL barriers between activation and commit, current writer versus
  stale writer, distinct scopes, rollback, deadline and cancellation. Use an
  ordinary role; PGlite does not prove these physical holder orders.

Implementation checks also authenticate each retained claim against its immutable
readiness frame, including the complete policy digest. Rehashing the claim,
activation and head cannot erase ownership while readiness remains unchanged.
The 64-record recovery budget currently admits 21 ownership activations: one
head plus 21 activation/claim/readiness triples. Activation 22 refuses and rolls
back, leaving the head recoverable and every earlier activation replayable.
This is a deliberate private admission ceiling, not an unbounded lifecycle claim;
a later compaction/retention capability must precede sustained production use.

Policy activation serializes legacy control-schema publication with the target
newness decision. It holds the control deployment
row lock before taking the target scope clock, through target settlement. Final
history reads use that same control transaction via an opaque issued lease.
Control remains read-only and the target remains the sole activation decision
owner. A control-lock cleanup failure after target commit is a resource failure;
it does not imply target rollback. Exact activation replay recovers that outcome.
The native test pauses at head installation, verifies the exact waiting
legacy publisher and stale writer, and proves unrelated-scope progress.

Reuse the manifest-owned Application preservation lanes for the connected
document/OCC/relation/commit/read behavior. Run focused affected package
typechecks serially with the compiler memory/CPU bounds, pure cases without
database startup, the shared PGlite scenario and focused PostgreSQL scenario,
both standing reviewers and staged lint. No broad DB suite is needed per policy
case. Reconcile the roadmap and commit the complete owned capability.

After this denial boundary is implemented, the CMS host can consume its exact
policy projection, activate the content overlay and prove successful Application
row publication under the existing proposal. The next consumer milestone remains
the pinned Payload scalar Local API proof, then native relations and real Medusa
Currency; this ownership gate is not framework compatibility evidence.
