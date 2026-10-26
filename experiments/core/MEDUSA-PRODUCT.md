# Bounded native Product flows

Status: native scalar update, retrieve-by-ID and list-by-handle are connected to
the experimental core. The standalone and mixed graphs use the executing native
service methods. Active Medusa integration remains unchanged. This is a closed,
relation-free construction profile. Initial [measurements](./RESULTS.md) miss the
added-median-latency goal; broader support and performance acceptance remain open.

## Reuse and ownership

| Owner | Disposition |
| --- | --- |
| Promoted ProductModuleService and internal services | Reuse actual update/retrieve/list, normalization, errors, serialization and native event behavior |
| compileProductDefinition, compileCompleteRow and compileRowProjection | Reuse checked DML metadata and complete/selected scalar decoders; no active execution host is imported |
| prepareCommerceInternalService | Reuse immutable native class preparation and repository injection after its dependency audit |
| Active repository, manager bridge and command host | Replace core-coupled plumbing here; do not emulate the old working set or CommerceCommandContext |
| Native event subscriber/aggregator and bus contract | Reuse production of native intents; the shared accepting owner publishes them atomically |
| Framework command, read, root, equality and materialization owners | Own authority, observations, pending membership, bounds, conflicts, publication and recovery |

Executing business sources are the promoted fork recorded in
`third_party/medusa/SOURCE.json`. Comparisons also fingerprint actual executing
bytes; a version or Git HEAD alone does not identify dirty source. Native
algorithms are not copied. The Convex ownership reference remains applicable,
while framework commands retain their distinct direct profile and no automatic
Application OCC retry.

## Admitted operations and complete results

Updates admit a nonempty subset of title, handle and status by existing ID.
Checked DML projection validates supplied values; native services retain their
normalization and validation. Inputs capture the combined ID/data envelope before
native execution, refuse getters/prototypes and use the common 262,144-byte
boundary. Native own-undefined omission precedes that bounded envelope, so omitted
and undefined members share identity and results. Application/Payload retain
their strict JSON input policy. Handle and identity text must be well formed
and NUL-free.

Preserve every native scalar column, nullable/boolean/metadata values and ordinary
NOT_FOUND behavior. Update output includes its actual loaded options/tags as empty
arrays and collection/type as null. Other unloaded relations are absent. Default
retrieve/list outputs contain complete scalar rows and native null collection/type
references; unloaded options/tags and other to-many relations are absent.
The same metadata decoders validate live results, saved results and recovery.
An atomic Product graph additionally verifies agreement across all three results.

The installation's closed writer set has no Product associations. Empty relation
answers are justified only by that installation. Managed fields, soft deletion,
child relations, Pricing/Links, workflows and remote effects remain unsupported.
Administrative fixtures seed through the real core writer; they do not implement
or claim native createProducts support.

The binding's unambiguous duplicate-handle failures retain native Medusa
`INVALID_DATA` and the underlying core cause. A standalone Product command also
projects a late accepting unique failure; mixed acceptance does not guess which
framework owns a generic multi-table unique failure. The diagnostic uses a generic duplicate-handle message;
it does not reproduce PostgreSQL's interpolated constraint-detail wording.
No supported consumer requires that wording in this construction profile.
Generic optimistic conflicts remain conflicts. No extra integrity query or
duplicate native normalization is introduced for the projection.

## Commands, queries and mixed execution

`medusa-product.ts` constructs the native binding and translates its actual DAL
arguments, results, events and errors. Native code receives an opaque manager
identity and issued operations, never database or settlement capabilities. Native
services are bound once for a complete atomic Product graph. All DAL promises,
including serialization/events, retain revocation and drain ownership.

Standalone update and atomic update/retrieve/list use `framework-command.ts`:
one reservation, one root and one acceptance. Only the trusted owner accepts,
resolves uncertain acceptance or aborts. Framework commands do not automatically
replay native execution after a conflict. The displaced single-table finalizer
has been removed; fixtures and ownership witnesses use the actual selected
accepting owner and its frozen-candidate projection.

`framework-read.ts` supplies standalone native retrieve/list without command
reservation, pending state or outcome publication. One invocation admits one
complete point or equality acquisition. Native serialization remains local;
a second acquisition is refused and latched rather than silently switching
observation times. Separate retrieve and list calls are independent reads.

The core freshly authorizes the selected definition and scope before protected
data acquisition. Equality reads use the scope sequence observed by that short
acquisition and the same bounded historical query builder as mutation roots.
Exact full text, not a fingerprint alone, proves handle equality. No physical
transaction spans native service execution. Read capabilities close after the
native invocation and retain caught failures, revocation and draining.

The mixed graph borrows the same Product binding and native update/retrieve/list
methods over its shared snapshot and pending root. New-handle membership is
visible before publication; its exact equality dependency participates in the
one mixed acceptance alongside Application and Payload evidence.

## Proof and measurement gates

Connected witnesses cover complete outputs/readback, no read reservation,
pending handle changes, native errors/events, replay identity and saved-result
corruption, rollback, stale writers and independent controls, fresh revocation,
cancellation/draining and escaped read capabilities. PGlite and ordinary-role
PostgreSQL are separate proof lanes. A real PostgreSQL interleaving checks that
a handle read keeps its observed sequence when a writer commits between the
authority observation and historical query.

The opt-in genuine native comparison checks every returned key/value for both
standalone and atomic relation-free sequences, excluding independent installation
timestamps after validating those timestamps. It does not measure performance.

Measure the complete native update/retrieve/list sequence, not one raw method.
The existing populated Product reference also seeds tags/categories/options,
images and a variant: relation-free results do not establish that larger graph.
Keep this missing match and the active-core preparation blocker explicit.

Use VALIDATION.md for exact source/settings fingerprints, separate latency/CPU/SQL
diagnostics, growing batches, indexed/nonindexed edits, pending queries, unrelated
schema and same/different-scope concurrency. Product construction alone cannot
establish full mutation acceptance, general framework support or deployment.
