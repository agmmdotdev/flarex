# Source validator wire and parser parity

Status: **Remaining translation gate; independent challenge pending**.
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