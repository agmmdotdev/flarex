# Unified Application, CMS And Commerce Developer Contract

## Status And Scope

Status: proposal for the developer contract and connected implementation gates.
The owner selects a unified product experience with explicit Application, Payload
and Medusa operation ownership. Public API names, signatures, schema syntax and
unresolved lifecycle policies below remain proposals, not implemented contracts.

This document connects the desired backend experience to existing authorities.
It does not replace accepted architecture, authorize implementation through this
documentation change, or advance public, hosted, production or compatibility
gates. Existing scoped implementation approvals retain their own authority.
Dashboard behavior supplies backend requirements; frontend implementation is
outside this proposal. The active Medusa integration keeps its existing scope.

## Current Sources Of Truth

- [Accepted database design](../../../design-notes/flarex-db-accepted-design.md)
  controls architecture and shared schema/commit authority.
- [Payload adapter design](../../../design-notes/flarexdb-payload-relational-adapter.md)
  owns CMS exposure, schema ownership and framework lifecycle boundaries.
- [Shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
  owns cross-framework identity, integrity and dependency contracts.
- [Execution architecture](../../execution-architecture/architecture.md) owns
  direct operations, borrowed participants and outer settlement.
- [Payload adoption](../07-payload-adoption.md) owns adapter capability coverage;
  [the SDK roadmap](../../09-sdk-and-cli-fork.md) owns eventual public authoring,
  generated references, typing and developer facades.
- [The shared-storage roadmap](../../shared-logical-storage/README.md#early-cross-framework-proof)
  owns the required connected proof and remaining storage gates.

Code and decisive tests determine implementation status. Examples in this
proposal do not override those sources or freeze public syntax.

## Product Direction And Ownership

Provide one Flarex workspace where content can select real commerce records and
application logic can consume or compose supported operations over both. Content
and commerce management may be separate sections of the same workspace. A common
login or screen does not grant identical permissions or create atomicity.

Keep one authoritative dataset with stable scoped identities, rather than
synchronizing a second product database into the CMS. Payload is the content
behavior owner; Medusa is the commerce behavior owner; neither becomes the
FlarexDB engine. Postgres remains committed data and outcome authority.

| Responsibility | Owner |
| --- | --- |
| Application business logic and application-owned writes | Flarex application functions |
| Content access, defaults, validation, hooks and admitted lifecycle | Payload through its adapter |
| Commerce services, workflows and business lifecycle | Medusa through its adapter |
| Canonical logical definitions, rows, indexes, unique claims and admitted relation integrity | Existing Flarex schema, analysis and persistence owners |
| Atomic completion, conflict handling, durable result and publication | The selected trusted outer execution owner |

Schema ownership and ordinary write ownership remain distinct. A compatible CMS
view can expose an existing Application table without duplicating its definition,
rows or history. Displaying Medusa data never grants direct Payload writes.

The accepted exposure modes remain:

| Mode | CMS behavior | Ordinary write owner |
| --- | --- | --- |
| Application table | No CMS surface | Application database operations |
| CMS view | Read-only presentation over the same table | Application operations or owning domain commands |
| CMS managed | Editable content through Payload | One admitted Payload operation pipeline |
| Command managed | Presentation and explicit business actions | Owning application or commerce commands |

For CMS-managed tables, ordinary application database writes must be excluded
from generated capabilities and rejected at runtime. They are not silently
redirected to Payload. Allowed reads may expose the same current/published data
under an explicit visibility contract. Field visibility or edit permissions do
not establish independent column write owners. General column-level ownership
and transfer of existing app-writable tables are not admitted by this proposal.

## Proposed Schema Authoring Experience

For the desired Flarex-first experience, declare a content field shape once and
attach CMS exposure and presentation metadata. CMS metadata must express content
behavior that basic database validators cannot, without creating a second schema
authority. Medusa model definitions come from the admitted native producer, not
handwritten copies of built-in commerce tables.

Illustrative TypeScript only; `.cms`, `relation.optional` and `commerce.products`
are placeholders, not current exports or selected syntax:

```ts
export default defineSchema({
  campaigns: defineTable({ name: v.string() }),

  articles: defineTable({
    title: v.string(),
    featuredProduct: relation.optional(commerce.products),
  }).cms({ mode: "managed" }),
});
```

The implementation must choose how this authoring form and native Payload
collection configuration lower into the existing canonical schema and policy
owners. Today the ordinary Payload compiler runs in the other direction:
supported collection definitions produce Flarex definitions and write-policy
evidence. A general Flarex-schema-to-Payload generator is pending.

Keep the core `flarex` package free of Payload runtime dependencies. Optional
CMS tooling and trusted adapter construction own the appropriate dependencies.
Private composition, ownership and serving proofs precede public API selection;
this sketch does not bypass that order or introduce a second catalog.

## Proposed Mutation Experience

Retain the Convex-style `mutation` function as the place to compose backend work.
Use explicit domain operations rather than generic nested writes across a graph.

| Illustrative surface | Contract to design |
| --- | --- |
| `ctx.db` | Application-owned writes and explicitly allowed reads |
| `ctx.cms` | Admitted Payload-style collection operations |
| `ctx.commerce` | Admitted Medusa-style services and workflows |

Names and signatures are proposals. An eventual facade preserves the selected
native operation's argument/result semantics; a module service call is not
automatically equivalent to a higher-level workflow. The sandbox receives only
restricted typed methods, never raw databases, repositories, containers,
transaction handles or finalizers. Principal and scope come from authenticated
execution, not caller-selected authority or an implicit access override.

Illustrative handler body only; the following exact combination is not available
through a public API and requires a connected implementation gate:

```ts
// Inside mutation({ args: ..., handler: async (ctx, args) => { ... } })
const article = await ctx.cms.findByID({
  collection: "articles",
  id: args.articleId,
});
if (!article.featuredProduct) throw new Error("Select a product first");

await ctx.commerce.product.updateProducts(article.featuredProduct, {
  title: args.productTitle,
});
await ctx.cms.update({
  collection: "articles",
  id: article.id,
  data: { title: args.articleTitle },
});
return await ctx.db.insert("campaigns", { name: args.articleTitle });
```

For an admitted atomic mixed mutation, all participants borrow its pending state
and execution authority; only the trusted outer owner settles. Failures,
rollback-only state, conflict retry, cancellation, duplicate delivery and uncertain
COMMIT retain the existing execution contracts. Borrowed calls cannot fall back
to independently committed direct operations. A public facade must not promise
that every direct framework operation also supports borrowing.

Do not hold a database transaction across untrusted application code, arbitrary
hooks, remote effects or workflow suspension. A workflow involving waits or
external work needs its separately admitted durable execution contract. Creating
a product and subsequently saving an article may intentionally be two committed
operations; article failure then leaves the product intact. Atomic composition
requires an explicit supported contract, not mere sequential API calls.

## Reference Assignment And Target Mutation

An article owns its `featuredProduct` field. Changing the reference is a content
operation. Changing the referenced product is a commerce operation. Traversal or
population grants no target mutation capability.

Illustrative assignment through the proposed CMS facade:

```ts
await ctx.cms.update({
  collection: "articles",
  id: articleId,
  data: { featuredProduct: anotherProductId },
});
```

Keep nested product creation or edits inside that field unsupported initially.
Do not infer which Medusa service/workflow to run from nested content data.
An editor action can explicitly create/edit through commerce and then select the
resulting identity. Content deletion does not implicitly run commerce deletion.

Distinguish an ordinary typed ID from a declared strong reference. A typed ID
does not alone select target-liveness, deletion or reverse-access guarantees.
For a declared strong relationship, core must enforce correct endpoint identity,
scope and target liveness against final pending state, maintain derived reverse
indexes, and resolve reference-insertion/target-deletion races atomically under
the admitted policy. The framework/domain boundary separately checks whether
the principal may discover, select or read that target. Revalidate on save;
picker results are not authorization or integrity evidence for a later write.

No cross-shop reference or automatic cross-owner cascade follows from shared
physical storage. Native Medusa Module Links retain their separate compatibility
contract; stronger reference policies must not be applied to Links implicitly.

## Implemented Capabilities And Pending Work

| Capability | Current boundary and evidence |
| --- | --- |
| Ordinary application queries/mutations and document API | Existing [SDK context](../../../packages/flarex/src/server.ts); no public CMS/commerce facade |
| Payload collection compilation | [Compiler](../../../packages/payload-adapter/src/collections.ts) emits canonical definitions and write-policy evidence for its admitted profile; general Flarex-first CMS generation is pending |
| Private Payload CRUD and indexed queries | [Adoption](../07-payload-adoption.md), [indexed queries](../../shared-logical-storage/05-indexed-payload-queries.md), compound/null uniqueness contracts; bounded private profiles, not complete Payload parity |
| Application direct-write refusal for retained CMS ownership | Existing [policy](../../../packages/persistence-postgres/src/application/ownership/Policy.ts) and [commit guard](../../../packages/persistence-postgres/src/application/ownership/Commit.ts); automatic public codegen narrowing remains pending |
| Native relation integrity and selected Payload consumers | [Relation commit owner](../../../packages/persistence-postgres/src/application/relations/commit/Repository.ts) and [configured relation scenario](../../../packages/persistence-postgres/test/integration/payload/payloadConfiguredRelationshipScenario.ts) cover target failures, restricted deletion and concurrency within admitted profiles |
| Selected mixed Application/Product/Payload mutations | [Private attempt contract](../../mixed-mutation-core/02-payload-local-api-attempt-preflight.md) and [configured scalar collections](../../mixed-mutation-core/configured-payload-attempt-preflight.md) exercise native operations and one root outcome through the existing [fixture](../../../packages/executor/test/performance/support/mixedMutationProductFixture.ts); no general public mixed API or borrowed relationship support |
| Borrowed Payload operation coverage | [Participant binding](../../../packages/payload-adapter/src/participant/binding.ts) selects create, update and findByID only; direct operation coverage does not expand this allowlist |
| Application/Payload/Medusa strong-reference execution | Pending; [common source admission](../../shared-logical-storage/25-cross-source-runtime-admission.md) refuses unsupported relationship-bearing sources before issuing runtime authority |
| Public authoring, relation helpers and generated facades | Pending under the SDK roadmap; all example syntax here remains illustrative |
| Connected cross-framework queries, general access/hooks, drafts, dashboard and hosted production serving | Separate pending gates; private storage/mutation evidence grants none of these capabilities |

Do not infer missing-target enforcement for article-to-product references from
the completed Payload-to-Payload relation tests. Existing fast PGlite and focused
ordinary-role PostgreSQL evidence remains bounded to its actual profiles.

## Open Decisions And Deferred Scope

Before implementation of a selected relationship, decide:

- Initial endpoint/cardinality support, schema authoring inputs, generated target
  handles and method exposure. Final facade signatures belong to the SDK owner.
- Product discovery versus assignment permission and public versus editorial
  reads. Common authentication does not collapse content/commerce permissions.
- Product soft deletion, restoration, article drafts/publication and unavailable
  targets. Retaining an identity and showing an authorized unavailable state is
  a candidate policy, not an implemented or universally accepted default.
- Hard-delete policy. Restricting deletion while strong references remain is a
  candidate first policy, not an automatic change to Medusa behavior.
- Bounded forward/reverse reads, pagination, error projection and permitted
  cross-framework query snapshots/dependencies.
- Whether a feature needs a live reference or an explicit historical business
  snapshot; an order snapshot must not become an accidental second product owner.

General nested graph writes, arbitrary external-effect hooks, full framework
parity and a universal transaction API are outside this proposal. General
populated-data conversions and write-owner transfers remain under the
[deferred evolution authority](../../shared-logical-storage/deferred-framework-schema-evolution.md).
Reactive relation claims retain `SV-R Live` and sync prerequisites. No durable
data reset, public rollout or production activation is authorized here.

## Convex Compatibility And Flarex Divergences

Preserve explicit JavaScript query/mutation composition and simple document
operations. The local [Convex reader contract](../../../../../npm-packages/convex/src/server/database.ts)
returns null for absent documents and explicitly distinguishes ID normalization
from existence. A declared strong relationship adds an intentional Flarex
integrity contract; it must not silently reinterpret every typed ID as a foreign
key. Separate Payload/Medusa facades preserve their framework behavior instead
of making generic application patches stand in for domain operations.

## Next Correctness Gates

1. Specify one bounded private connected scenario: a Payload article selects an
   admitted Medusa product and Application campaign logic consumes the connected
   result. Define principals, scope, visibility, errors and deletion policy before
   enabling the relationship. Complete the owning shared-storage proof in both
   directions, including a reference originating in an admitted Medusa extension;
   article-to-product alone does not close that gate.
2. Correct existing shared owners where necessary, then prove real native APIs,
   indexed forward/reverse access, pending-state integrity, two-shop refusal,
   target-delete races, rollback and supported uncertain-outcome recovery. Use
   PGlite semantics and ordinary-role Postgres concurrency/query-plan evidence
   separately. Preserve access and unsupported-policy refusal without adapter SQL,
   extra settlement paths or a second relation engine.
3. Prove incompatible dependency/schema refusal, admitted activation/rebinding and
   recovery while leaving general conversions deferred. Inventory actual durable
   obligations and retire displaced paths with the consumer migration.
4. Only after private composition/ownership proofs, select public authoring and
   generated operation contracts through the SDK preflight. Prove writer
   narrowing plus runtime bypass refusal, native method/result fidelity, scope
   closure and sandbox/package boundaries. Keep public rollout, hosted operation,
   reactive behavior and performance acceptance separately gated.
