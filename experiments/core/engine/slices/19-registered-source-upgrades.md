# Registered ordinary Application source upgrades

Status: **Ordinary registered-source upgrades implemented and reviewed;
production activation and general framework conversions remain gated.**

Authorized continuation of [public activation](./18-public-application-activation.md).
Use the shared checkout, preserve concurrent changes, and do not deploy. Baseline:
`d31c5df21ea79ba63e25dc4e1d9814361396611a`. Convex reference:
`db914cf06e2b06ee985646611b9e12ed7a770318`. Task replacement, performance work,
general cross-framework conversions and production activation remain separate.

## Independent challenge and disposition

Three read-only agents independently inspected the current Core/consumers,
accepted architecture and pinned Convex, then challenged the candidate and
replay contracts with each other. Before this replacement, registration required one live schema, an identical
complete registration and empty pending tables. Discovery rejected active plus
pending, and program closure checks rejected retained revisions. Those
restrictions have been removed from the ordinary Application profile.

Pinned `application/deploy_config.rs::start_push/finish_push` and
`components/config.rs::modify_component` prepare immutable source outside a
transaction and atomically publish source, modules, schema and indexes.
`SchemaModel::submit_pending` reuses equal active or pending schemas. Multiple
code attempts may share a schema; distinct eligible finishes publish in finish
order. A different schema supersedes the pending schema, not every older code
attempt. There is no latest-start generation fence.

The shared schema/index/validation owners already implement populated scans,
write-time candidate validation, index generations and atomic activation.
Omitted tables retain identities, data and intrinsic indexes. Definition removal
does not authorize table-data deletion or infer data-conversion meaning.

| Current owner | Replacement / preserved mechanism |
| --- | --- |
| `_schemas` stores both schema state and public source-attempt identity | Separate typed deployment records in the existing Core `_programs` catalog; schema equality and lifecycle remain in `_schemas` |
| Registration requires one fresh immutable closure | Authenticate one active deployment closure while retaining historical program revisions and independently prepared attempts |
| Program publication only adds revisions and heads | Retain immutable revisions; atomically replace the complete active head set, removing omitted heads |
| Public start/finish/read/abandon use schema ID as push ID | Use an independent durable attempt ID and its referenced shared schema proposal |
| Mutation admission resolves current function before committed outcome | Authenticate request correlation and resolve durable outcome before current function/kind/argument admission; preserve original claimed execution authority |
| Active-source check precedes all private execution | Keep exact source admission for fresh work while allowing authenticated original-outcome recovery and original claimed retry |

The [registered-upgrade divergence](../divergences/registered-application-source-upgrades.md)
records the public durable-attempt and retry adaptations. Original signed-program
retry remains governed by its existing accepted divergence.

## Connected contract and data disposition

Core owns `prepareApplicationCandidate`, candidate read, active candidate read,
candidate activation and candidate abandonment. An attempt binds immutable
registration/source/package/manifest/program evidence to a reusable schema
proposal. Public candidate IDs remain opaque and independent of schema IDs.
Active discovery reads the active deployment pointer, not whichever candidate
was prepared last. No adapter installs, builds, validates or settles separately.

Same-schema attempts A and B may each finish while their schema remains eligible.
The later distinct successful finish publishes its source. A completed attempt's
repeated finish returns its durable result without restoring old code after B.
A new start intentionally redeploying old source is a new validated transition.
Pending/failed/abandoned attempts never replace the active closure. Incompatible
records fail candidate validation; active-compatible writes may fail a pending
candidate without failing their own publication. Missing/unready index state
refuses finish rather than being repaired implicitly there.

If an eligible older-schema code finish removes a newer candidate's pending
index, that candidate's next start reconciles the missing allocation through
the existing index preparation owner and preserves its eligible attempt ID.
Ordinary in-progress indexes keep their identity; finish never creates missing
indexes. Duplicate start of the current completed source remains a no-op and
does not discard another attempt's pending work.

Abandon affects its attempt only. It cannot cancel a schema shared by another
attempt or alter active data. Shared schema/build state may remain for ordinary
overwrite. Fresh never-active cleanup retains its existing exclusive ownership,
emptiness and historical-data guarantees. Neither cancellation nor omission of
a table deletes physical history or committed application data.

Current registration writes typed deployment records and the active pointer in
`_programs`; `_schemas` owns schema lifecycle only. The startup upgrader from the
earlier `_schemas`-coupled candidate format is retired under the owner's
[no-data disposition](./16d-local-legacy-core-retirement.md). Current candidate
IDs, evidence, timestamps/disposition, schema links and active identity retain
their registered-source upgrade and recovery contracts. The five physical
families remain unchanged.

Queries retain one coherent program/schema/index/data snapshot. New calls see
the current complete published closure. Mutation retries retain their original
signed program while each attempt obeys its current snapshot validators and
index metadata. A committed lost-ack result remains recoverable after function
removal, kind/argument changes or a source upgrade, with the same authenticated
identity, path, arguments and request key. No missing or uncertain outcome
authorizes an unrelated fresh body or a caller-selected historical bypass.
No SQL transaction spans analysis, upload or untrusted execution.

Fresh admission binds both the artifact root and public package hash. Inline
authentication settings can change the package without changing JavaScript or
program identity. A query checks that complete pin in its captured Core snapshot;
a fresh Application claim checks it in the same settling claim transaction.
Original committed recovery and already-issued claims retain their original
authority across later package changes. A host-only precheck cannot substitute
for those snapshot/claim dependencies.

Trusted generic Core admission preserves its existing retained-program contract:
`begin` requires that revision and a current head, while generic claims require
the retained revision. A different current head does not replace the original
authority. Transactions still observe current head presence and any supplied authority epoch;
intervening publication or revocation conflicts, and each retry uses current
validators and indexes. Exact fresh source/head admission belongs to the explicit
Application query/claim entry points. Applying that equality to generic admission
caused the unchanged retained-A-after-head-B bootstrap witness to refuse with
`programUnavailable`; the disposition is to correct Core, retain that witness,
and prove the generic/explicit distinction rather than loosen public admission.

Public calls with omitted kind and an idempotency key remain unambiguous at the
Core owner: resolve a correlated historical mutation first; otherwise infer the
current admitted query or mutation. An internal inference request carries this
choice without changing the public shape. A keyed query keeps query behavior,
and a removed mutation can still recover its original result. Adapters do not
perform a second lookup or catch a failed mutation and fall back to a query.

## Ownership, cleanup and proof

The Core worker owns deployment catalog/registry/proofs, migration, schema
handoff, program-head publication, database APIs and both-driver owner tests.
The invocation worker owns committed-first mutation correlation and original
program/replay consumers, coordinating database changes with the Core owner.
The executor worker owns public/private candidate composition, discovery,
transport/projection and affected SDK callers/tests. The coordinator owns actual
public/normal-SDK upgrade proofs, docs, shared-checkout auditing and final review.
Workers share the checkout; the database owner serializes overlapping edits.

Required witnesses on PGlite and ordinary-role PostgreSQL include populated
code/schema/index upgrades, same-schema concurrent attempts, finish-order
publication, old-finish idempotency, attempt-scoped abandon, concurrent writers
failing pending validation, omitted-table retention/reintroduction, immutable
program history and removed heads, cold restart and old-format metadata migration.
Controlled races must park at the contested observation, not depend on timing.

The actual public backend/service-binding/canonical-DO/analyzer/isolated-Worker
graph must prove normal SDK upgrades with existing data, old service while
pending/failed/abandoned, auth/visibility/validator changes, removed functions,
lost activation and mutation acknowledgements, replay after removal, cold
reconstruction and no legacy fallback. Run affected source/type/lint/generation
and bundle checks; both read-only project reviewers gate the scoped commit.
Remove displaced direct-registration APIs, schema-coupled candidate code and
fixtures when their consumers migrate. Record actual remaining limits without
claiming deployment, broad native upgrades, capacity or performance.
