# Native Link Characterization And Shared Storage Contract

Status: native reference characterization and the approved shared-core B2
correction are complete for the bounded contract below. Stored Link B3
promotion and workflow Gate C remain unapproved. This is the shared storage
contract for [preflight 55](./55-shared-installation-atomic-commerce.md), not
admission of the native Link adapter.

## Outcome And Scope

Admit one authoritative ProductSalesChannel row through the existing commerce
store and atomic host, with native identity, duplicate and lifecycle semantics.
First correct the shared declared-key and observation owners; then promote the
finite native Link closure. No Sales Channel branches in core, generic CRUD
framework, new coordinator, new workflow engine or version-suffixed API.

The accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary)
and [Link design](../../../design-notes/flarexdb-medusa-commerce-adapter.md#2-commerce-owned-link-entity)
remain authoritative. The contract below does not waive the
[commerce-link commit gate](../06-medusa-adoption.md#commerce-link-commit-admission).

## Reference Boundary

The semantic source is the admitted fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline `2.13.4`.
The reference runs inside its independently installed workspace, never through
Flarex runtime imports. It uses the actual native `generateEntity`,
`getLinkRepository`, `LinkService`, `LinkModuleService`, base repository,
decorators, serializer, event builder and `mikroOrmCreateConnection` factory.
Its locked MikroORM version is `6.4.16`.

The storage observations below come from ordinary-role PostgreSQL 18, not an
ORM mock, Flarex store, PGlite or deployed Worker. Only the Link table exists in
the diagnostic schema, deliberately allowing an absent-endpoint witness.
A recording event sink observes actual native event calls; it does not prove
native durable delivery. Original `remote-link.spec.ts` assertions are retained
and runnable separately; those mocked routing cases are not storage evidence.

## Observed Native Contract

The physical primary key is `(product_id, sales_channel_id)`. Generated `id` is
a non-unique indexed column, not the physical key. Scope is Flarex's additional
mandatory key prefix when this is eventually admitted.

| Operation | Stored and returned behavior | Native event intent |
| --- | --- | --- |
| First attach | Inserts one active row with generated `prodsc_...` ID and database timestamp defaults. Returned ID equals stored ID. No endpoint existence check occurs. | One attached message for the generated ID. |
| Repeat attach in a fresh transaction | Replaces the stored ID; preserves stored `created_at` and `updated_at`; remains active. This is not a no-op or request replay. | One new attached message for the replacement ID. |
| Dismiss active pair | Preserves ID/creation time, sets deletion time and updates stored `updated_at` at flush. Serialized response contains the earlier `updated_at`, before that flush. | One detached message for the preserved ID. |
| Repeat dismiss, or dismiss absent pair | Returns `[]`; no physical update. | None. |
| Attach after dismiss | Replaces ID, clears deletion, preserves stored creation/update timestamps from before the attach. | One attached message for the replacement ID. |
| Soft-delete selected endpoint | Returns requested `product_id` and `sales_channel_id` maps; changes active rows only. Repeat selection of an already deleted pair returns `{}`. | Detached for the first transition; none on repetition. |
| Restore deleted pair | Preserves ID, clears deletion and changes stored update time; returns requested endpoint maps. | Attached for the preserved ID. |
| Repeat restore of active pair | Returns the same endpoint maps, with no physical update and unchanged timestamps. | Still emits attached for the existing ID. |
| Same pair twice in one batch | Rejects with PostgreSQL `21000`, `ON CONFLICT DO UPDATE command cannot affect row a second time`; transaction rolls back. Observed for absent, existing and manager-preloaded pairs. | None from the rejected call. |
| Same pair in two calls sharing one transaction manager | Both calls succeed with different serialized IDs; the second ID is finally stored. | One attached intent per call, including the earlier ID. |
| Two overlapping transactions attaching the same pair | The second transaction waits on a PostgreSQL lock; both succeed after the first commits, with the second ID finally stored and the first insertion's timestamp defaults preserved. | One attached intent per successful call. |

The overlap witness holds the first transaction open after its write and observes
`pg_stat_activity.wait_event_type = 'Lock'` for the second backend before releasing
the first. Merely launching two Promises was insufficient: an earlier diagnostic
schedule executed them serially.

For this Link, native event envelopes contain:

- name: `LinkProductSalesChannel.attached` or `.detached`;
- metadata source: `ProductProductSalesChannelSalesChannelLink`;
- metadata object: `LinkProductSalesChannel`, with matching action;
- data: `{ id }`, not the endpoint pair; delivery option `{ internal: true }`.

Creation passes endpoint-bearing objects to the event builder, but the emitted
payload projects them to `{ id }`. Do not confuse builder input with wire intent.
Native event grouping may aggregate repeated identities; the later adapter proof
must use the actual aggregator rather than assuming a fact/message bijection.

### Transaction And Timestamp Qualifications

Passing a native transaction manager through `LinkModuleService.create` and
`LinkService.create` retains that transaction: forcing outer rollback removes
the row. The recording event sink is nevertheless invoked before that rollback.
The existing Flarex buffer/commit owner must retain sole delivery authority;
native event invocation is an intent, never proof of commit.

The actual fresh-manager upsert statement updates only `id` and `deleted_at` on
conflict. The `beforeUpdate` hook is not run by this upsert path. A reused manager
can include already hydrated timestamp fields in its upsert statement, reducing
stored timestamp precision to JavaScript milliseconds. Dismiss serializes before
the later update hook. These ORM timing/precision artifacts are observed, not a
reason to reproduce an identity map or deferred flush engine in Flarex.

## Accepted Shared-Owner Correction

Current owners are `packages/persistence-postgres/src/commerceTransaction/`
and `commitPublication/relationalRowKey.ts`, with invocation/event validation in
`atomicCommerce/`. The approved correction stays within these owners.

### Declared Keys And Mutation

1. Extend existing declared-primary-key update, removal and lifecycle admission
   to the bounded ordered text-key contract already accepted by
   `selectRelationalRowKey` (scope plus one to sixteen non-null components).
   Do not invent a Link ID key or another key codec. Test two rows sharing the
   first component so first-component-only matching cannot pass.
2. Correct connected lookup logic, not only the admission length check.
   `store.ts` lifecycle now matches the full canonical declared key, and update
   predicates compare every key component. The displaced first-component-only
   assumptions have no retained compatibility path.
3. Extend the existing local store's admitted upsert capability. Its public
   `write(..., "upsert", ...)` spelling already exists, but local row profiles
   refuse it unless their table admission selects `upsert: "activeRow"`; the
   scalar path is unchanged. The profile fixes conflict and managed-field authority
   at construction; commands cannot supply arbitrary SQL, mutable key definitions or
   per-call timestamp-policy flags from commands.
4. For the active-row upsert contract, insert uses managed defaults;
   conflict replaces admitted business fields, clears managed deletion and
   preserves managed creation/update timestamps. Keep caller timestamps and
   arbitrary deletion values refused. This is an explicit reusable storage
   capability, selected by a profile, not an implicit behavior for every table
   declaring soft deletion. Existing scalar/update consumers retain their
   admitted contracts.
5. Reject duplicate declared keys across the entire input before batch splitting.
   Never turn the native failed batch into deduplication or sequential upserts.
   Preserve refusal and whole-root rollback; map to the existing typed boundary
   error, not a leaked SQL statement or promise of identical driver prose.
6. Distinguish repeated attach from outer request replay. Different accepted
   requests may replace an ID; replay of the same request must return its stored
   outcome without another mutation, event or regenerated ID.

### Lifecycle, Results And Compatibility Decision

Native selectors, absence handling, lifecycle maps and event selection remain
Medusa-owned. Core takes exact admitted row keys and owns their atomic transition,
authoritative returned rows and evidence. Preserve missing-exact-key refusal in
core; native no-match selectors can supply an empty selected set.

Under the accepted lifecycle contract, restoring an already active
row returns an observed row but does not touch its timestamps or invent a row
mutation fact. A native repeated-restore event can still be admitted from that
observation. The old unconditional update is replaced, including the existing
Product lifecycle consumer. Product's native restored event intents remain
admitted from storage-owned lifecycle observations, without manufacturing facts.
The profile's canonical contract records `observe-unchanged-restore` when lifecycle
is selected, so a retained old binding cannot silently acquire new semantics.

**Accepted explicit divergence:** return authoritative post-write timestamps
and preserve stored precision rather than reproducing native stale dismiss
responses or manager-dependent precision loss. Continue using the existing
database-owned lifecycle clock, not a new adapter clock. Preserve ID replacement,
batch refusal, selector/map behavior and event semantics. This approved divergence
has separately labeled assertions; it is not unchanged native compatibility.
Keeping native timestamp artifacts instead would require a
separately justified Medusa-owned result contract, never arbitrary core clocks
or a second flush/settlement engine.

### Receipt, Event And Fact Representation

Reuse `CommerceRowClosure` as the transaction-bound receipt and the
existing relational fact as the physical Link-row fact. Its installation,
artifact, table and encoded full primary key identify the authoritative row;
the common finalizer already authenticates admission/lifetime and consumes the
closure once. Add no `commerceLink` feed family, second finalizer, independently
writable edge projection or Link-specific core receipt brand merely for naming.
This resolves the adoption roadmap's receipt/fact representation requirement,
not its Link admission gate: B3 must still prove the checked native Link profile.

Key-only evidence is insufficient for complete native Link event admission:

- `RelationalRowFact` contains key and operation, not the non-key generated ID.
- `CommerceLifecycleObservation` contains deletion state but not that ID.
- Command input/result captures are not substitutes for storage-owned evidence.
- A repeated restore legitimately emits an event with no mutation fact.
- Earlier attached IDs in a multi-call transaction may no longer appear in the
  final row; a final-state-only comparison would reject valid native intents.

The existing store observation boundary now supplies bounded, immutable,
operation-local row evidence produced by the actual mutation/lifecycle owner,
including unchanged lifecycle outcomes when `observeRows: true` is selected at
profile construction. It reuses validated/hydrated rows and charges retained
evidence to the existing request byte and fact-count ceilings. The fifth
trusted event-validator argument receives this snapshot; commands cannot supply
or mint it. Existing profiles do not retain full row evidence unless opted in.
The future Medusa Link validator must check
the selected pair, observed ID, lifecycle outcome and actual event aggregation.
Physical mutation facts still describe only actual writes and retain normal
ordering; event-only accepted work uses the existing commit/outbox authority.
No claim about durable before/after row payload feeds is made.

High-level native `Link.delete` means cascade soft-delete, not repository hard
delete. It returns cascade errors as data. A future atomic adapter boundary must
latch/refuse a nonempty error result; it must not acknowledge partial work as
success. This remains a native portability/event-validation obligation, not a
new core cascade algorithm.

## B2 Completion And Remaining B3 Gates

The approved B2 slice covers the shared declared-key/mutation/observation
correction above, including the named timestamp divergence and Product lifecycle
impact. The following B3 promotion supplies the
checked Link schema/metadata and native service closure, then Gate C supplies
the actual association step. Neither follows automatically from this document.

- Neutral owner fixtures must prove composite key confinement, shared-prefix
  independence, upsert insert/conflict/reattach, unchanged lifecycle observation,
  duplicate batches across chunk boundaries, complete facts and wrong-event-ID
  rejection. Another supported profile must use the same mechanics without a
  module-name branch.
- Run both PGlite and ordinary-role real PostgreSQL for the core correction;
  native PostgreSQL characterization alone is not either Flarex proof lane.
- Preserve scope-clock ordering, rollback-only failure, quotas, one settlement,
  single-use closures, replay, interruption and uncertain-commit recovery.
  Wrong participant, forged observation and escaped-lifetime cases must refuse.
- B3 must prove native Link behavior on the fresh fifteen-table configured
  candidate, with separate Product, Sales Channel and Link profiles. No endpoint
  FK/liveness check is inferred from being a Link; both endpoints must still be
  confined to the admitted scope/module configuration.
- Broader cardinalities, extra fields, reverse query aliases, endpoint cascade
  traversal, multiple link types, arbitrary registries, full Product creation,
  durable workflow pauses and production activation remain separate gates.
- Run applicable typechecks, source guards, lint, both required code reviewers
  and a scoped commit when implementation is approved and complete.

## Retain / Extend / Replace / Delete

| Action | Ownership and gate |
| --- | --- |
| Retain | Pinned native sources and original assertions; existing profile/store/finalizer/key owners and supported consumer contracts. |
| Extend in B2 | Declared-key local mutation/lifecycle and bounded storage-owned observations. B3 must explicitly admit the native Link consumer. |
| Replace in B2 | Single-component assumptions and the no-op restore mismatch; authoritative timestamps supersede ORM timing/precision artifacts. No legacy branch is retained. |
| Delete | Temporary executable diagnostics after preserving the reproducer below; no surrogate-key, adapter-SQL, duplicate finalizer or identity-map emulation scaffolding. |

## Isolated Reproduction

Use the independent workspace/install commands in
[`third_party/medusa/README.md`](../../../third_party/medusa/README.md).
Verify the source pin, then compile the native utils package with its own
TypeScript (`--filter @medusajs/utils exec tsc -p tsconfig.json`). Existing
framework/deps generated outputs must come from the same verified island.
Do not add a root workspace dependency or change the pinned source files.

Provision an empty local PostgreSQL test database owned by a role with
`NOSUPERUSER NOCREATEDB NOCREATEROLE`. The probe below uses database/user
`flarex_atomic` on loopback port `55439`; substitute only isolated test settings.
Set that test role's `search_path` to `native_link_characterization, public`:
native partial-index DDL uses an unqualified table name. Confirm the diagnostic
schema is absent before running; its name is reserved for this probe and it is
dropped in `finally`. Stop the owned server afterwards.

Save the following as an ignored `.cjs` diagnostic inside the island's
`node_modules/.cache/`, and execute it with the island as the working directory.
It reports complete native results, database rows, SQL and event calls, including
expected errors. Inspect all named outcomes against the matrix; exit zero alone
does not establish semantic conformance. The recording sink performs no external
delivery. Direct SQL here observes and sets up an isolated native reference; it
is not an allowed Flarex adapter implementation.

```javascript
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = process.cwd();
const native = createRequire(path.join(root, 'packages/modules/link-modules/package.json'));
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: {
  module: 'Node16', moduleResolution: 'Node16', target: 'ES2021',
  experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
}});
const { MikroORM } = native('@medusajs/framework/mikro-orm/postgresql');
const utils = native('@medusajs/framework/utils');
const source = (file) => native(path.join(root, 'packages/modules/link-modules/src', file));
const { ProductSalesChannel: config } = source('definitions/product-sales-channel.ts');
const { generateEntity } = source('utils/generate-entity.ts');
const { getLinkRepository } = source('repositories/link.ts');
const LinkService = source('services/link.ts').default;
const LinkModuleService = source('services/link-module-service.ts').default;
const model = generateEntity(config, ...config.relationships);
const events = [];
const queries = [];
const plain = (value) => JSON.parse(JSON.stringify(value));
async function main() {
  const orm = await utils.mikroOrmCreateConnection({
    clientUrl: 'postgresql://flarex_atomic@127.0.0.1:55439/flarex_atomic',
    schema: 'native_link_characterization', debug: false, pool: { min: 0, max: 4 },
  }, [model], path.join(root, 'packages/modules/link-modules/src/migrations'));
  orm.config.getLogger().logQuery = ({ query, params }) => queries.push(query);
  try {
    const connection = orm.em.getConnection();
    console.log('ROLE', await connection.execute('select current_user, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user'));
    await connection.execute('create schema native_link_characterization');
    await orm.schema.createSchema();
    const repository = new (getLinkRepository(model))({ manager: orm.em, joinerConfig: config });
    const linkService = new LinkService({ linkRepository: repository });
    const service = new LinkModuleService({ baseRepository: repository, linkService,
      primaryKey: 'product_id', foreignKey: 'sales_channel_id', extraFields: [],
      entityName: 'LinkProductSalesChannel', serviceName: config.serviceName,
      event_bus: { emit: async (messages, options) => events.push(plain({ messages, options })) },
    }, {});
    const snapshot = () => connection.execute('select * from native_link_characterization.product_sales_channel order by product_id, sales_channel_id');
    async function probe(name, task) {
      const eventStart = events.length;
      const queryStart = queries.length;
      try {
        const result = plain({ value: await task() });
        console.log(JSON.stringify({ name, result, rows: await snapshot(), events: events.slice(eventStart), queries: queries.slice(queryStart) }));
      } catch (error) {
        console.log(JSON.stringify({ name, error: { name: error.name, code: error.code, message: error.message }, rows: await snapshot(), events: events.slice(eventStart), queries: queries.slice(queryStart) }));
      }
    }
    await probe('first attach, absent endpoints', () => service.create('prod_a', 'sc_a'));
    await probe('repeat attach, fresh transaction', () => service.create('prod_a', 'sc_a'));
    await probe('dismiss', () => service.dismiss('prod_a', 'sc_a'));
    await probe('repeat dismiss', () => service.dismiss('prod_a', 'sc_a'));
    await probe('reattach after dismiss', () => service.create('prod_a', 'sc_a'));
    await probe('softDelete and linkable keys', () => service.softDelete({ product_id: 'prod_a' }, { returnLinkableKeys: ['product_id', 'sales_channel_id'] }));
    await probe('repeat softDelete and linkable keys', () => service.softDelete({ product_id: 'prod_a' }, { returnLinkableKeys: ['product_id', 'sales_channel_id'] }));
    await probe('restore and linkable keys', () => service.restore({ product_id: 'prod_a' }, { returnLinkableKeys: ['product_id', 'sales_channel_id'] }));
    await probe('repeat restore', () => service.restore({ product_id: 'prod_a' }, { returnLinkableKeys: ['product_id', 'sales_channel_id'] }));
    await probe('duplicate pair in fresh batch', () => service.create([['prod_b', 'sc_b'], ['prod_b', 'sc_b']]));
    await probe('duplicate existing pair in batch', () => service.create([['prod_a', 'sc_a'], ['prod_a', 'sc_a']]));
    await probe('same pair twice within one native transaction', () => orm.em.fork().transactional(async (manager) => {
      const first = plain(await service.create('prod_c', 'sc_c', undefined, { transactionManager: manager }));
      const second = plain(await service.create('prod_c', 'sc_c', undefined, { transactionManager: manager }));
      return { first, second };
    }));
    await probe('duplicate batch after pair loaded into same manager', () => orm.em.fork().transactional(async (manager) => {
      await service.list({ product_id: 'prod_c' }, {}, { transactionManager: manager });
      return service.create([['prod_c', 'sc_c'], ['prod_c', 'sc_c']], undefined, undefined, { transactionManager: manager });
    }));
    await probe('concurrent same pair', () => Promise.allSettled([
      service.create('prod_d', 'sc_d'), service.create('prod_d', 'sc_d'),
    ]));
    await probe('confirmed overlapping same-pair conflict', async () => {
      const firstReady = Promise.withResolvers();
      const releaseFirst = Promise.withResolvers();
      const secondReady = Promise.withResolvers();
      const first = orm.em.fork().transactional(async (manager) => {
        const rows = await service.create('prod_lock', 'sc_lock', undefined, { transactionManager: manager });
        firstReady.resolve();
        await releaseFirst.promise;
        return rows;
      });
      await Promise.race([firstReady.promise, first]);
      const second = orm.em.fork().transactional(async (manager) => {
        const [{ pid }] = await manager.execute('select pg_backend_pid() as pid');
        secondReady.resolve(pid);
        return service.create('prod_lock', 'sc_lock', undefined, { transactionManager: manager });
      });
      let lockSeen = false;
      try {
        const pid = await Promise.race([secondReady.promise, second]);
        for (let attempt = 0; attempt < 100; attempt++) {
          const states = await connection.execute('select wait_event_type from pg_stat_activity where pid = ?', [pid]);
          if (states[0]?.wait_event_type === 'Lock') { lockSeen = true; break; }
          await require('node:timers/promises').setTimeout(10);
        }
      } finally {
        releaseFirst.resolve();
      }
      const outcomes = await Promise.allSettled([first, second]);
      assert.equal(lockSeen, true);
      return { lockSeen, outcomes };
    });
    await probe('provided manager rollback witness', async () => {
      await assert.rejects(orm.em.fork().transactional(async (manager) => {
        await service.create('prod_rollback', 'sc_rollback', undefined, { transactionManager: manager });
        throw new Error('characterization rollback');
      }), /characterization rollback/);
      assert.equal((await snapshot()).filter((row) => row.product_id === 'prod_rollback').length, 0);
      return 'rollback retained';
    });
    await probe('dismiss missing pair', () => service.dismiss('prod_missing', 'sc_missing'));
    console.log('SUMMARY', JSON.stringify({ rowCount: (await snapshot()).length }));
  } finally {
    await orm.em.getConnection().execute('drop schema native_link_characterization cascade');
    await orm.close(true);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
```
