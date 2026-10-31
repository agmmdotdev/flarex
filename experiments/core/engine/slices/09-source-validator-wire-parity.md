# Source validator wire and parser parity

Status: **Independent challenge and peer exchange complete; runtime contract and activation dispositions pending**.
This is a source-alignment requirement, not an accepted DO/native divergence.
The numeric literal translation and ordered source-semantic record admission in
[08](./08-validator-literal-parity.md) do not claim complete raw validator wire
or parser parity.

Pinned Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`, especially
`npm-packages/convex/src/values/validators.ts` and
`crates/common/src/schemas/{json,validator}.rs`.

## Confirmed current gap

Convex SDK record JSON wraps `values` as `{ fieldType, optional }`; Flarex's
shared validator wire stores the value validator directly. The core source
schema JSON parser/serializer already understands the source wrapper. The
Application/function wire and its consumers still need a connected translation.
Existing private wire shape is a replacement input, not a permanent exception.

Backend source parsing also differs from strict SDK/value JSON decoding: Rust
accepts tagged positive zero and normalizes it, while strict JS decoding refuses
that tag. Apply the correct ingress policy rather than silently making one
universal decoder. Ordered semantic record rejection in 08 closes the newly
exposed Int64-key admission gap; it does not establish raw malformed-key/value
parse precedence for the existing simplified grammar.

Flarex source table analysis currently admits only object roots. Fresh metadata
construction shares that existing supported subset after 08; this is not a claim
that Convex supports only object roots. The pinned SDK `server/schema.ts`
`defineTable` overloads document unions of objects, and `addSystemFields` handles
objects, unions and `any`. Challenge actual backend/schema admission, SDK types,
inference and all consumers together before translating table-root support.
The current private root restriction is another replacement input, not a permanent
DO/native exception; preserve literal/record error stages while removing it.

## Required connected outcome

Challenge the actual SDK export, backend parser, shared protocol, canonical
manifest/signature, stored metadata, generated Worker and core schema owners
independently. Translate source grammar and error stages through one owning
projection, removing displaced private grammar. Inventory real field-name,
optional-value, deprecated-validator, Unicode and canonical-order rules before
extending any complete source-serialization claim.

Preserve the SDK constructor/export/parse/complete-analysis distinctions,
source record error order, exact scalar identity, union order and source schema
hashes. Keep semantic runtime values distinct from wire DTOs and finite persisted
schema conversion. Preserve named historical function-metadata capabilities.

Changing an existing positive record's canonical bytes can change manifests,
program IDs, schema bindings and authenticated identities. Inventory actual
retained rows/heads/outcomes and select an explicit compatible decoding or
migration disposition before activation; no reset or data deletion is inferred.
Do not add a compatibility engine merely for unshipped private APIs.

Prove real SDK-to-analysis-to-authenticated-publication execution and cold reopen
in PGlite and ordinary-role PostgreSQL, actual Worker/DO consumers, existing
positive bytes or the approved identity migration, malformed-input refusal and
first-error stages. Payload/Medusa remain logical schema producers above the
same core; add no physical storage or adapter repair for parser defects.

## Independent challenge and peer convergence

Baseline: `1ddfc2e616343f0f1bafbd45ecd6b146337a128c`. Three read-only agents
independently challenged current owners, accepted direction and pinned source,
then exchanged objections. No runtime implementation or data disposition is
inferred from this agreement. The following contract replaces the initial
simplified assumptions; select coordinated workers after the remaining evidence
and identity decisions below are recorded.

### Source parsing and semantic phases

Keep useful bare semantic `record.values`. Source DTOs instead require
`values: { fieldType, optional }`; the SDK emits `optional: false`. Backend DTO
parsing completes before semantic conversion. `literal.value` can be any JSON
value at the DTO stage, and an ID table name can be an empty string until its
semantic parser runs. Today's early literal-tag/nonempty-ID capture cannot be
reused unchanged as source DTO admission.

After DTO parsing, record conversion is key recursion, string-subtype check,
value recursion, string-literal-key refusal, then optional-value refusal. A bad
numeric-tag *payload* is a semantic failure; a missing/nonboolean wrapper field
is a raw DTO failure. Consequently an outer non-string key outranks a
semantically invalid value, while malformed raw structure anywhere can preempt
semantic conversion. Do not infer fixed semantic order for competing raw faults.

Original export/schema JSON text must survive until its source policy is checked.
Ordinary `JSON.parse` loses duplicate-key and raw nesting evidence. Keep generic
JSON parsing for unrelated consumers; one source text/DTO projection belongs
with the existing pure protocol owner, followed by ordered semantic conversion.
Retain descriptor-only foreign capture, captured intrinsics and explicit
strict-JS versus backend-source numeric-tag policies. Source accepts tagged
positive zero; strict JS/value decoding still refuses it.

Pinned owners: `crates/json_trait/src/lib.rs`,
`crates/common/src/schemas/json.rs` (`ValidatorJson`, `FieldTypeJson` and their
conversions), and `npm-packages/convex/src/values/validators.ts` (`VRecord`).

### Source table normalization and shared consumers

The actual backend root rule, after recursive validator conversion, admits
`any`, an object, or a union whose immediate members are all objects. Empty
unions pass; nested unions and unions containing `any` fail. The same rule
applies to active and staged document schemas. Singleton object unions normalize
to an object; empty/multiple-member union order remains meaningful.

Table normalization strips **every** top-level underscore-prefixed field after
its child validator has parsed, before finite serialization/hash construction.
A valid nonfinite literal under a removed field can disappear before finite
conversion; a malformed/semantically invalid child there still fails. Nested and
function object fields retain their underscores. Function analysis similarly
parses arguments and returns before completing finite serialization, in that
order; a return admission error can precede an argument's finite refusal.

Reuse the current core document-root normalizer rather than create another root
engine. Translate portable SDK authoring and union/any document inference,
shared Application schema/manifest types, declarative tables, source analysis,
generation and actual Worker consumers together. Named field-map convenience
builders can remain narrower producers if they do not restrict shared roots.
Native logical views/references currently dereference object fields; narrow
those capabilities explicitly or prove their branch semantics. Do not merge
union fields permissively or repair missing core behavior inside adapters.

Pinned owners: `crates/common/src/schemas/json.rs` (`DocumentSchema` and table
conversion), `validator.rs` (`filter_system_fields`) and SDK `server/schema.ts`.
The current core counterpart is `schemaTypes.normalizeCoreDocumentValidator`.

### Names, remaining variants and input limits

Source object declarations use identifier field names, not arbitrary data record
keys. Validate the executing printable-ASCII/identifier rules, length limits and
all-underscore refusal before field semantic conversion in BTree order. Keep
literal Unicode/control/NUL strings and distinguish unpaired surrogates from
U+FFFD; do not add normalization. Do not turn documentation-only record-key
restrictions into runtime rules without an executing source owner.

`function` and `commitTs` are real backend validator variants, and Function is a
source-accepted string subtype for record keys. Map/set are source aliases for
`any`. Resolve the connected core/runtime scope of these variants explicitly;
adding tags without value/subset semantics does not translate them. Do not call
omitted variants native-invalid or a necessary DO divergence. A bounded result
must name any further translation gate rather than claim complete grammar parity.

Current 1,024-field, 65,536-node and logical-depth-128 validator caps are not
established pinned source limits. Ordinary source serde JSON parsing has a raw
container nesting limit, including wrappers; this is not logical validator depth.
The current caps are reapplied by downstream semantic, manifest/core and frozen
admission callers, so changing only the first source decoder is insufficient.
Translate actual limits coherently. Any retained stricter host limit needs a
proved requirement, guarantee assessment and its own divergence record; bounded
capture alone does not justify those numerical choices.

### Identity and historical-format decision gate

Keep semantic values, source DTOs, source schema/hash bytes and canonical
manifest/publication bytes distinct. Existing core source schema serialization
already emits the record wrapper, so a wire change alone does not justify
changing its valid-record hashes.

Ordinary-record wire changes alter manifests, publication frames, runtime targets
and program identities. `coreProgram.readCoreApplicationProgram` recomputes these
bytes against stored identities. Accepting old shapes does not preserve old
program authentication or heads. Inventory actual active heads, retained program
revisions, manifests/signatures/receipts, schema bindings, Task identities,
accepted/uncertain requests and committed outcomes before activation.

Select either an explicit historical identity/projection discriminator for named
obligations or an authenticated migration of all correlated identities. Preserve
actual public/active/inflight/outcome recovery obligations; do not infer blanket
reexecution of every inactive revision or permission to delete. No reset or
generic fallback compatibility engine is authorized by this record.

Historical `appDocument` definition version 1 is explicitly object-only in the
accepted design. Deliberately replace/version the fresh definition and migrate
callers; do not silently widen the frozen version. Frozen c554 and Function
Metadata V1 have real named consumers and retain their old bare grammar,
canonical bytes and historical nonfinite capability until their removal gates.
Stored schema reads remain lazy; fresh finite construction policy is separate.

### Remaining evidence and completion

Actual durable-data inventory and the selected correlated identity disposition
remain open. Duplicate-known-field and tuple/sequence `FieldTypeJson` behavior
also remain **unexecuted oracle questions**. Do not promote them to asserted
vectors before running a matching derived-serde witness. The cached serializer
oracle from 08 used serde_core 1.0.229; the pinned lockfile uses 1.0.228. That
oracle proves its recorded finite serialization vectors, not exact derived DTO
parsing. Use verbatim pinned DTO declarations and matching versions in a focused
independent harness; a full Convex/toolchain build is not required.

Required conformance includes raw-versus-semantic precedence, optional wrappers,
source/strict positive-zero behavior, names/surrogates/aliases, root variants and
filtered fields, union index containment, populated active/proposed/staged
rewalks, and pre-change registered program/head/outcome recovery. Prove real
SDK-to-analysis-to-authenticated-publication-to-Worker execution and cold reopen
in PGlite and ordinary-role PostgreSQL separately. Cover actual Worker/DO module
transport and restart, affected native producers, approved Oxc checks, lint and
both mandatory post-change reviews. Managed hosting and full-request performance
remain wider goal gates; existing Task provenance/host guards remain open.
