# Native schema source composition

Status: **Selected fresh multi-source contract implemented; general evolution,
broader native profiles and hosting gates remain open.**

## Source and required difference

Convex `db914cf06e2b06ee985646611b9e12ed7a770318` has one complete active/pending
schema per real table namespace. `ByComponent` denotes a real component; it is
not a framework label. Keep its proposal, validation, index work and activation
algorithm. Payload/Medusa are additional native schema producers, so combine
their authenticated definitions before that same algorithm. They require no
additional physical table or per-framework installation engine.

## Representation and authority

An opaque `CoreSchemaBundle` contains the complete derived schema, optional
analyzer-issued Application source, native source definitions and table bindings.
Reuse `LogicalSchemaSource` records directly. The retained candidate-v2 format's
mandatory Application analysis does not require inventing a manifest/function
for a native-only bundle. Schema-only Application issuance invokes the actual
analyzer with zero execution modules; it grants no developer-function execution.

Preserve legal App/Payload table names. A non-App qualified logical identity
needs a legal Source table identifier. Hash the canonical versioned frame
`["flarex.core.native-table", 1, namespace, logicalName]` using full SHA256;
encode all 256 bits with Source's lowercase base32 alphabet
`0123456789abcdefghjkmnpqrstvwxyz`, with prefix `n_` (54 characters).
Retain the original qualified coordinate and local name in the authenticated
binding. Reject collisions, including with App names. Configuration, bundle
contents, deployment allocations and source-array position do not enter this
mapping. Do not reuse the old physical-table namer or fake component namespaces.

Native key/index descriptors containing characters forbidden by Source use the
same full-digest encoding over their versioned qualified table/kind/native-ID
coordinate, with `k_`/`i_` prefixes. Preserve original identities in the source
binding and unique constraint descriptor; the constraint's installed `indexName`
selects the legal Source descriptor. The selected native null-predicate index
has its own [lowering record](./native-null-partial-index.md).

## Installation and cold authentication

Store one tagged `flarex.core-schema-bundle` version 1 wire in existing logical
schema metadata, including complete source evidence, identities, bindings,
lowering version and native policy meaning. Native policies attach only to
native tables; Application tables retain Application ownership. Preserve the
exact untagged Native10/11 Payload reader, wire and semantic identity.

The trusted construction owner rebuilds expected opaque bundle proofs through
actual producers before Core opens. Bootstrap and metadata-candidate validation
compare full source/schema/policy/ownership/index closure to those proofs.
Recomputing hashes of altered Currency defaults is insufficient. Unknown tagged
formats or missing expected proofs fail closed before serving. The ordering
owner only folds previously authenticated maps, without hashing or I/O.

Fresh installation and identical interrupted/reopened retry are selected.
Changed active sources, populated ownership transfer and general data evolution
remain refused before mutation, preserving the prior ready combination. Each
native command keeps its per-source identity, including existing scope/epoch
UUIDs. Unrelated sources, bundle hashes and allocated IDs cannot change it.

## Proof

Cover genuine three-source installation, interrupted retry/reopen, altered
source/policy/index closure, missing proof, collision refusal, wrong ownership,
changed-source refusal and unchanged Payload replay. Database evidence must be
separate for PGlite and ordinary PostgreSQL. This record alone activates nothing.
