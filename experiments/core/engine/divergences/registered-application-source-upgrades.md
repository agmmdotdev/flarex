# Registered Application deployment attempts and durable retries

Status: **Implemented and reviewed for ordinary Application source upgrades.**

Owner: [registered source upgrades](../slices/19-registered-source-upgrades.md).
Reference: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Source mechanism and required adaptation

Pinned `SchemaModel::submit_pending` reuses equal active/pending schemas.
`finish_push` publishes complete source/module/schema/index changes atomically.
An equal-schema older start may finish after a newer start; no global
latest-start fence rejects it. A different schema overwrites the pending
schema. Active schema enforcement and candidate write-time validation remain
distinct. Omitted tables/data survive schema changes; only explicit table
deletion has deletion meaning.

Source's start response is not a durable per-finish idempotency record. Repeating
an old same-schema finish can republish old code. Flarex already admits public
candidate status, abandon and uncertain-finish retry as durable obligations.
The earlier fresh-only representation coupled these to `_schemas`; it cannot
represent independent code attempts sharing one schema without changing source
ordering or destroying recovery evidence.

Use typed deployment-attempt and active-pointer records in the existing logical
Core `_programs` catalog, beside program revisions/heads/runtime authority.
This avoids a new physical family or an independent installer. `_schemas`
continues to own the actual schema proposal, validation and shared lifecycle.
Core's same admin transaction atomically activates eligible schema/index state,
replaces the complete active program-head closure, publishes the active source
pointer and records the attempt's terminal activation result.

Distinct same-schema attempts preserve finish-order source publication. Exact
retry of a completed attempt returns its retained result without reactivating
its old code after another finish. A new intentional redeploy of old source
creates/revalidates a new transition. Abandon is attempt-scoped; it does not
destroy shared schema state. Safe exclusive fresh cleanup remains supported.
Public evidence retains its existing named recovery lifetime; no production
garbage-collection policy is invented here.

An identical start retry for the current completed source also remains a no-op;
it does not overwrite another attempt's pending schema. Pinned Source reuses
the active schema and may overwrite pending schema work during that start.
The difference preserves the admitted durable public retry identity. A distinct
eligible code finish still follows Source's schema/index rules: it may remove a
newer pending index. The newer attempt's next start uses shared preparation to
recreate missing allocations, while finish continues to refuse unprepared work.

## Cutover and preserved authority

Migrate the previous `_schemas` application metadata atomically at Core startup,
authenticating its proof and preserving public IDs, evidence, disposition and
active identity. Remove the displaced fields and runtime decoder after this
one-way metadata handoff. Business documents, table identities, program/source
history and request outcomes are preserved; the physical schema is unchanged.

PostgreSQL alone settles the transition. Cloudflare carries transport, source
objects and execution; no R2/SQLite activation gate or transaction across remote
effects is added. Existing original signed-program retry is preserved rather
than granting new source authority by function path. Committed authenticated
outcome recovery precedes current function/validator admission, as in pinned
`application_function_runner` committed-first handling.

The private invocation pin includes the public package hash as well as the
artifact root: inline JWT settings participate in the former, so an auth-only
update can leave the latter and program identity unchanged. Fresh queries
consume the active registration in their captured snapshot; fresh Application
claims consume it in the existing claim transaction. Known outcomes and
originally issued claims keep their historical authority. This closes the gap
between public authentication and private fresh admission without another
lookup owner, database lifetime or transaction across untrusted execution.

Those explicit public checks do not narrow trusted generic Core admission.
Generic transactions retain their admitted immutable revision across a benign
head change while observing the current head and any supplied authority epoch; generic claims
retain their existing program-exists contract. Original authority still obeys
current validators, indexes, revocation and conflict checks. This preserves the
accepted signed-program retry rule without granting fresh public callers a
historical-source bypass.

Required evidence is both-driver migration/state/race coverage and actual
public Workerd/PostgreSQL upgrade/restart/lost-ack proofs. Native framework
upgrades, arbitrary conversions, explicit destructive table deletion, deployment,
capacity and performance remain separate gates.
