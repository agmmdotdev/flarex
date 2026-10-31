# Connected validator literal translation

Status: **Bounded connected translation implemented; source wire parity remains open**.
This follows the shared schema milestone. It is ordinary pinned Convex behavior,
not a DO/native divergence. The remaining raw source grammar belongs to [gate09](./09-source-validator-wire-parity.md); wider goal gates remain open.

Pinned source: `db914cf06e2b06ee985646611b9e12ed7a770318`, especially
`crates/common/src/schemas/json.rs` (LiteralValidator conversion),
`crates/common/src/schemas/validator.rs` and `crates/value/src/sorting.rs`.
The source admits signed Int64 literals and finite negative zero. It encodes an
Int64 literal through the Convex value JSON representation; persisted schema JSON
and validator hashing normalize float literals through serde_json. Positive and
negative zero have distinct value identity. NaN/infinity literals are refused
when serializing the persisted schema.

At the starting baseline, the shared Application validator admitted only strings, booleans
and finite numbers excluding negative zero. Its earlier bounded schema translation must
therefore be described as exact source serialization for the admitted subset.
Do not copy this old restriction into a permanent TypeScript-core design.

## Connected owners

- Protocol validator semantic types, encoded forms, bounded no-getter admission,
  runtime decoding and error diagnostics: `flarex-protocol/validator-json-core`,
  `validator-json`, `validator-engine-core` and existing value codecs.
- Core schema parsing, source serialization, validator hashing and subset proofs:
  `schemaTypes`, `schemaJson`, `validatorSubset`. Replace the current literal
  `===` equality before enabling negative zero; a false subset proof could skip
  validation or carry a staged proof incorrectly.
- Shared authoring/export: application-schema-definition's ValidatorJson owner,
  Flarex values/server, Application and Standard authoring and generated source.
- Analysis, canonical manifests/publication, stored function metadata, compiler
  admission and actual live Worker consumers. Migrate or retire retained exact
  runtime consumers according to the named inventory, then regenerate artifacts.

Use the existing Convex signed-int64 encoding, not an ad hoc string or lossy JS
number. Preserve `1n` versus `1` and `-0` versus `0` through source generation,
analysis, signatures, stored metadata, schema hashes and runtime values. Project
encoded validator values at the owning boundaries; do not broaden generic JSON
or silently change canonical bytes for existing positive literals. The total
rewrite permits connected internal changes without a compatibility engine.

## Required proof

Challenge current consumers, accepted direction and pinned source independently
before implementation. Prove int64 min/max and overflow, bigint versus number,
signed-zero args/returns/document writes, active/proposed/staged validation and
subset/rewalk decisions. Include pinned source hash vectors and the real
SDK-export → analysis → signed manifest → stored metadata → Worker → cold-reopen
path. Shared migration and native callers must consume the same owners rather
than repairing missing encoding in adapters. Keep search/vector, shapes and
native constraints as separately scoped remaining gates.
## Independent challenge and selected contract

Baseline: `14487fac25598084b5a1b6629767b267bad87e0a`. Three read-only agents
independently inspected current consumers, accepted direction and pinned source,
then challenged their findings with one another. The connected replacement is
within the total-rewrite authorization; it changes no transaction authority or
native framework guarantee. No new mechanism divergence is selected.

Pinned owners are `npm-packages/convex/src/values/validators.ts:583-600`,
`values/value.ts`, `crates/common/src/schemas/{validator,json}.rs`,
`crates/value/src/{sorting.rs,json/mod.rs}`,
`crates/isolate/src/environment/analyze.rs`,
`crates/model/src/modules/module_versions.rs:302-303` and
`crates/common/src/bootstrap_model/schema_metadata.rs:27`.

- Semantic literals distinguish Int64 from Float64 and all float bits: `1n`
  differs from `1`, and `-0` differs from `0`. Exact NaN payload/sign identity
  belongs to the in-memory value/validator mechanism, not JSON canonicalization.
- The SDK constructs any number/bigint literal. Signed-int64 overflow fails at
  export, not construction. Export uses existing eight-byte little-endian
  `$integer`/`$float` numeric encodings. Preserve branded ownership and bounded
  foreign capture while translating this stage behavior.
- Backend parsing can admit nonfinite float literals; successful complete
  function analysis subsequently serializes args, then returns and refuses
  NaN/infinity. Persisted schema conversion has the same finite requirement.
  Do not globally forbid these numbers in the semantic or SDK constructor owner.
- Source schema JSON/hash is its own projection: finite Float64 uses serde
  numeric text (`1.0`, `-0.0`); Int64 uses the value tag. SDK/manifest numeric
  projection keeps existing ordinary JSON numbers and tags special values.
  Rust source decoding accepts tagged signed zero while strict JS/value wire
  decoding refuses tagged positive zero; preserve the relevant boundary policy.
- Reuse one protocol semantic validator and explicit bounded encoded projection.
  Do not broaden generic JSON or serialize the entire validator with Value Codec.
  In particular, ordinary/NUL string literals keep current shared canonical bytes;
  the historical function-metadata format intentionally has its own value codec.
- Replace literal `===` subset/equality before admitting signed zero. Int64
  literals widen to bigint only. Preserve conservative source subset proofs,
  object field sorting and significant union ordering.

## Replacement map and ownership

| Current owner | Pinned mechanism | Replacement and cleanup |
| --- | --- | --- |
| Protocol primitive literal guards, recursive validator schema, runtime diagnostics | LiteralValidator, Convex value numeric encoding, exact comparison | Semantic bigint/all-float representation plus explicit wire codec; bounded own-data numeric-tag admission; exact numeric identity. Remove displaced primitive-only checks and duplicate numeric encoders. |
| Core schema JSON/hash/subset, schema lifecycle and c554 migration | Source ValidatorJson serialization and SchemaWorker proofs | Translate tagged Int64/negative zero, reject nonfinite at persistence, correct proof identity, preserve retained old catalogs/program heads/outcomes. Make historical c554 admission explicit rather than silently widening a frozen decoder. |
| SDK/Standard/Application authoring and source generation | VLiteral construction/export | Preserve source stages through owned authoring, export, generated TypeScript and schema export; remove JSON.stringify paths that erase negative zero or throw on admitted bigint. |
| Backend analysis, manifests, candidates, compiler/materializer and core-program identities | Complete analyzed-validator normalization plus authenticated deployment metadata | Project validators at canonical/signature/storage boundaries through protocol owner, preserve ordinary bytes and enforce new nonfinite refusal at successful analysis. Include Task manifests and publication identities. |
| Stored function metadata and retained Worker captures/runtime | Exact value matching | Retain named historical nonfinite/NaN decoder capability and existing bytes, add int64 without lossy embedding, regenerate actual Worker artifacts from source. |

Coordinated workers own protocol, core lifecycle, analysis/publication, and
SDK/generated/runtime consumers respectively. They exchange the protocol API
before dependent edits and do not overwrite others' shared-worktree changes.
The coordinator owns this record, clean projections, integrated validation,
required independent reviews and the scoped commit. Current paused Task and
persistence chats remain paused; their unrelated WIP is preserved.

No inspected Payload/Medusa producer requires literal-specific adapter edits.
Their shared-schema and native boundary regressions remain gates; an actual
consumer witness is required before expanding adapter work. This slice adds no
physical table and authorizes no reset or deletion of named durable data.

## Completion gates

Include constructor/export/admission error stages; signed-int64 extrema and
overflow; malformed, inherited, accessor, wrong-width and oversized tags;
`1n`/`1` and signed-zero equality/signatures/identities; unchanged prior ordinary
literal and historical metadata bytes; Rust serde schema/hash vectors; active,
proposed and staged schema rewalk decisions; SDK-to-signed-publication execution
and cold reconstruction. Validate PGlite and ordinary-role PostgreSQL separately,
actual Worker/DO consumers, affected typechecks/source guards and lint, then both
required read-only reviews of the exact owned checkpoint. Native capability,
retention/GC, managed deployment and broad performance claims remain separate
goal gates.
## Retained profile boundary

The old backend/persistence JSON-only validation profiles still have named
executing consumers and explicitly unsupported bigint/bytes transport. Their
metadata decoders and exact literal equality consume the shared owner; this
slice does not invent a second transport for them. Their previously recorded
retirement gate remains open. Fresh Application core and actual Worker paths
must support Int64 and signed zero through the canonical value transport.

The source-number reference uses standalone Rust with exact cached
`serde_json 1.0.151` / `serde_core 1.0.229` / `zmij 1.0.23`, with Literal field
ordering recreated from the pinned declaration. It supplies finite float text
and resulting hash vectors; it is not execution of the full Convex crate suite.
## Source admission and own-field preservation

Extending literals exposes an invalid record-key path previously blocked by the
blanket bigint refusal. Actual SDK export, analysis and manifest construction
admitted `record(literal(1n), number)`; pinned source rejects it with
`InvalidRecordType`. The correction belongs to shared source-semantic admission
before finite metadata normalization. Reuse its key predicates in core source
parsing. Keep constructors permissive and generic/historical semantic codecs
capable; neither is the successful source-deployment boundary.

Required order is recursive key validation, string-subtype check, recursive value
validation, then string-literal-key refusal. Source wrapper optional-value and
raw malformed-wire precedence belong to the explicit
[remaining wire gate](./09-source-validator-wire-parity.md).

Worker definition emitters parse encoded JSON text before rehydrating semantic
validators. A raw JavaScript object literal changes `__proto__` into a prototype
operation and loses the own field. Shared Application, Task and retained Worker
checks must preserve that field through real execution as well as preserve
Int64/signed-zero input and output identity.
Fresh source analysis and backend metadata builders enforce the ordered record
rule and finite conversion. Structural/historical manifest canonicalization
supplies representation and identity; it does not certify source admission.
Keep that distinction when reconstructing named stored programs and outcomes.
Pinned `SchemaMetadata::database_schema` and its stored-row conversion keep raw
schema text and parse lazily; they do not repeat the finite construction check.
Stored tagged nonfinite schemas can therefore be read, then fail new metadata
serialization. Match that stage distinction; malformed numeric tags still fail
as corrupt stored data. Do not add a finite-on-read restriction that source lacks.
Shared Task validator snapshots use application-schema-definition's immutable
capture after their existing admission policy. The displaced local copier lost
own `__proto__` fields through ordinary property assignment; its extra
`structuredClone` and duplicate recursive freezer are removed together.

Retained exact Worker artifacts bundle their portable protocol helpers while
retaining only the host modules already supplied by that runtime. Reproducible
single-file transpilation can leave an unresolved package import; it does not
prove a runnable module graph. The shared builder owns bundling, import allowlists,
source maps, byte ceilings and deterministic artifact checks. Real Worker tests
own the dependency and literal input/output witnesses.

## Export and metadata boundaries

Generated source embeds wire metadata with `JSON.parse` of quoted JSON text,
then rehydrates its semantic public exports. The authenticated metadata endpoint
returns the retained wire projection. It must not send native bigint or signed
zero through `Response.json`, which would throw or erase value identity.

Retained local/test deployment APIs also distinguish encoded wire ingress from
trusted semantic handoffs. Validation, plan construction, stored metadata and
HTTP responses use the shared protocol projections at their owning boundaries.
They must not double-decode semantic metadata as wire or rely on ordinary
`JSON.stringify` of a semantic validator. This metadata translation does not
add bigint/bytes application-data transport to the retained JSON-only profiles.

Table analysis applies the shared source-semantic record rule before finite
schema normalization, just as function analysis does. A table's invalid Int64
record key must produce `InvalidRecordType` before a later nonfinite value can
change that source error stage.

One bounded pure structural decoder owns semantic/wire validation and typed
reason/path diagnostics. Public protocol wrappers, SDK foreign capture and thin
Effect Schema adapters share that decoder; the displaced recursive Schema
structure is removed. Capture rejects malformed arrays, functions and field
containers before they can pass foreign getters to structural validation.
Strict excess checks retain unknown-key presence; default decoding strips it.

SDK construction and numeric export use captured trusted intrinsics, including
foreign validator capture after application code mutates ambient helpers. The
Effect Schema adapters assume the trusted host's Effect runtime remains intact;
they do not promise to repair arbitrary mutation of Effect's internal helpers.
That library assumption cannot weaken SDK capture or justify a second parser.
