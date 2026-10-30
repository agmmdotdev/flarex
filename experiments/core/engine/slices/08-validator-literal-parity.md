# Connected validator literal translation

Status: **Remaining translation gate; independent runtime-slice challenge pending**.
This follows the shared schema milestone. It is ordinary pinned Convex behavior,
not a DO/native divergence. No runtime implementation is claimed here.

Pinned source: `db914cf06e2b06ee985646611b9e12ed7a770318`, especially
`crates/common/src/schemas/json.rs` (LiteralValidator conversion),
`crates/common/src/schemas/validator.rs` and `crates/value/src/sorting.rs`.
The source admits signed Int64 literals and finite negative zero. It encodes an
Int64 literal through the Convex value JSON representation; persisted schema JSON
and validator hashing normalize float literals through serde_json. Positive and
negative zero have distinct value identity. NaN/infinity literals are refused
when serializing the persisted schema.

The current shared Application validator contract admits only strings, booleans
and finite numbers excluding negative zero. Its bounded schema translation must
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