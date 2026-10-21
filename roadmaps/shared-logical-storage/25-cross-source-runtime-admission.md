# Cross-Source Relationship Runtime Admission

Status: historical fail-closed correction, superseded for explicitly admitted
profiles by shared reference projection/publication and native Payload lowering.
The [private reference preflight](./cross-framework-reference-preflight.md) owns
the selected optional article-to-Product retention slice and remaining gates.
Current [source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts)
and [publication](../../packages/persistence-postgres/src/commit/publication/strongReferenceAdmission.ts)
own execution. The [strict cross-source scenarios](../../packages/medusa-adapter/test/logical-cross-source-admission.test.ts)
exercise the existing simple liveness/restrict profile; metadata alone still
grants no serving capability or complete authorized traversal.

## Historical Preflight And Decision

The shared candidate can authenticate a strong cross-source extension, but the
current generic row runtime has no corresponding target-liveness, reverse-index
or target-delete enforcement. Application and Payload scalar source admission
already refuse any candidate relationship touching their tables. Medusa
relational source admission uses the same `prepareLogicalSourceEvidence` result
but omits that refusal. A Product host could therefore receive a source token
for a candidate that declares a strong reference it cannot enforce.

Move the existing relationship refusal into the common source-admission owner,
after source identity and table-binding verification but before any runtime
token can be issued. All affected Application, Payload and Medusa sources must
fail as `unsupportedProfile`; an unrelated source in the same candidate may
still serve. Remove the duplicated Application/Payload checks and project the
Medusa host error at its existing commerce boundary. This is fail-closed
admission, not implementation of the relationship. It is required before a
connected strong-reference runtime can be activated and does not introduce a
second relation engine, adapter SQL, or a compatibility fallback.

This intentionally breaks the previously permissive private Medusa host path
for candidates with extensions. No named durable rows or candidate metadata
are deleted or reset. Native business APIs and candidates without relationships
are unchanged. The later relationship slice must replace this refusal only
after core liveness, indexed traversal, deletion/restore and concurrency proofs
exist for each supported policy; candidate metadata alone grants no serving
capability.

## Connected Proof And Gates

Admit a genuine Application/Payload/Medusa candidate with an Application-to-
Product strong reference. Build the generic definitions and activate its shared
binding. On PGlite and ordinary-role PostgreSQL, prove that Product,
Application and Payload source preparation refuse before a host token is
issued, and the composite host preserves the `unsupportedProfile` refusal,
while native Currency operations from an unrelated source still work. Confirm a
normal extension-free Product host remains admitted. Run affected typechecks,
source guards, lint and both read-only reviews. Do not claim cross-framework
references execute until the later core relation contract lands.
