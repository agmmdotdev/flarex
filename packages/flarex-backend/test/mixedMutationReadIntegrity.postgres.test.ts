import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { isNonArrayRecord } from "@flarex/utils/records";
import { fxControlScopes, fxSystemTransactionJournalReceipts } from "../../persistence-postgres/src/database/schema";
import { withInstallationMaintenance } from "../../persistence-postgres/src/database/postgresInstallationMaintenance";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { createMixedMutationProductFixture, prepareMixedMutationPerformanceSeries } from "./support/mixedMutationWorkerdFixture";
import { getCoLocatedReadInstallationReferences, loadCoLocatedReadInstallation, requireCoLocatedInstallationAdmission,
  isManagedInstallationTransaction } from "../../persistence-postgres/src/installation/installationLifecycle";
import { prepareProtectedMetadata } from "../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { createLocatedPointMutationSessionActivationTargetV1 } from "../../persistence-postgres/src/execution/transactionSessionActivation";

const cases = ["placement", "escapedPlacement", "controlPolicy", "targetPolicy", "controlMaintenance", "targetMaintenance",
  "controlLogin", "controlNamespace", "controlIncarnation", "controlEpoch", "targetEpoch",
  "controlClockEpoch", "targetClockEpoch"] as const;

describe.skipIf(postgresUrl === null)("finite installed read authority and tail", () => {
  it("rejects missing and foreign control preparations before constructing an accepting target", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres",
      suffix: "read-integrity-construction-pair" });
    try {
      const currency = fixture.currency;
      const managed = currency.managedRead;
      if (managed === undefined) throw new Error("Missing installed construction fixture");
      const database = currency.persistence.drizzle;
      const scope = await currency.application.sessionAuthority.scopeMetadata.getScopeMetadataByDeploymentId(currency.deploymentId);
      if (scope === null) throw new Error("Missing installed fixture placement");
      const refs = await Effect.runPromise(getCoLocatedReadInstallationReferences(managed.readInstallation, database));
      const controlProtection = await Effect.runPromise(prepareProtectedMetadata(database, refs.controlInstallation));
      const foreignPair = await Effect.runPromise(loadCoLocatedReadInstallation({ database,
        targetInstallation: managed.installation,
        control: { database: managed.control.drizzle, installation: managed.controlInstallation },
        controlEndpointPolicy: "colocated-control-read-fixture" }));
      for (const invalid of [
        { installation: managed.readInstallation },
        { installation: foreignPair, controlProtection },
      ]) {
        expect(() => Reflect.apply(createLocatedPointMutationSessionActivationTargetV1, undefined,
          [database, scope.physicalLocator, { managedInstallation: invalid }]))
          .toThrow(expect.objectContaining({ _tag: "PreparedMetadataEpochError", reason: "unprotectedRuntime" }));
      }
      expect(() => createLocatedPointMutationSessionActivationTargetV1(currency.control.drizzle,
        scope.physicalLocator, { managedInstallation: { installation: managed.readInstallation, controlProtection } }))
        .toThrow(expect.objectContaining({ _tag: "PreparedMetadataEpochError", reason: "unprotectedRuntime" }));
    } finally { await fixture.close(); }
  }, 180_000);

  it("accepts the first root after source publication following managed target construction", async () => {
    const series = await prepareMixedMutationPerformanceSeries({
      driver: "postgres", suffix: "read-integrity-fresh-control", profile: "product", sampleCount: 1,
      applicationSource: () => `export default { users: { create: { isMutation: true,
        isPublic: true, _handler: async (ctx, args) => {
          const seed = JSON.parse(args.body);
          return await ctx.privateMixed.call("medusa.product", "retrieve", seed.retrieveInput);
        } } } };`,
    });
    try {
      await series.prepareAttempt(0);
      const result = await series.runAttempt(0);
      expect(result.returnedValue).toMatchObject({ id: result.seed.productId });
      expect(result.publication).toMatchObject({ kind: "published" });
    } finally { await series.close(); }
  }, 180_000);

  it.each(cases)("fails the root after %s changes following complete entry", async changed => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let checking = false, altered = false, checked = false, dataStatements = 0, installedTransactionProjections = 0;
    let escapedTransaction: FlarexMetadataTransaction | undefined;
    let restoreObserver = () => {};
    const observe = async (statement: string) => {
      if (!checking) return;
      const data = /\bfx_app_(?:row_rev|index_entry_(?:rev|current)|unique_key)\b/.test(statement);
      if (data) dataStatements++;
      const epochBoundary = changed.endsWith("ClockEpoch") ? /current_timestamp/.test(statement) : data;
      if (!epochBoundary || altered || !changed.endsWith("Epoch")) return;
      altered = true;
      const namespace = changed.startsWith("control") ?
        (await fixture.currency.control.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema :
        (await fixture.currency.persistence.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
      if (namespace === undefined) throw new Error("Missing installed epoch namespace");
      await fixture.currency.control.drizzle.execute(sql`update ${sql.identifier(namespace)}.fx_system_prepared_metadata_epoch
        set generation = generation + 1 where singleton_id = 1`);
    };
    fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: `read-integrity-${changed}`, hooks: {
      onPreparedContext: async currency => {
        if (currency.resource.kind !== "postgres") throw new Error("Missing PostgreSQL query observer");
        const pool = currency.resource.target.pool;
        const database = currency.resource.target.drizzle;
        const originalTransaction = database.transaction;
        database.transaction = new Proxy(originalTransaction, { apply(transaction, receiver, args: unknown[]) {
          const callback = args[0];
          if (!checking || typeof callback !== "function") return Reflect.apply(transaction, receiver, args);
          return Reflect.apply(transaction, receiver, [async (tx: FlarexMetadataTransaction) => {
            escapedTransaction = tx;
            const session = tx._.session, originalPrepare = session.prepareQuery;
            session.prepareQuery = new Proxy(originalPrepare, { apply(prepare, preparedReceiver, queryArgs: unknown[]) {
              const query = queryArgs[0];
              if (isNonArrayRecord(query) && typeof query.sql === "string" && query.sql.includes("installed.target_installation")) {
                expect(preparedReceiver).toBe(session);
                expect(session).not.toBe(database._.session);
                expect(queryArgs[2]).toBeUndefined();
                installedTransactionProjections++;
              }
              return Reflect.apply(prepare, preparedReceiver, queryArgs);
            } });
            try { return await Reflect.apply(callback, undefined, [tx]); }
            finally { session.prepareQuery = originalPrepare; }
          }, ...args.slice(1)]);
        } });
        const patched = new Map<PoolClient, PoolClient["query"]>();
        const onAcquire = (client: PoolClient) => {
          const original = client.query;
          client.query = new Proxy(original, { apply(query, receiver, args: unknown[]) {
            const result: unknown = Reflect.apply(query, receiver, args);
            if (!checking || args.some(arg => typeof arg === "function")) return result;
            const first = args[0];
            const statement = typeof first === "string" ? first : isNonArrayRecord(first) && typeof first.text === "string" ? first.text : "";
            return Promise.resolve(result).then(async value => { await observe(statement); return value; });
          } });
          patched.set(client, original);
        };
        const onRelease = (_error: Error | undefined, client: PoolClient) => {
          const original = patched.get(client);
          if (original !== undefined) client.query = original;
          patched.delete(client);
        };
        pool.on("acquire", onAcquire); pool.on("release", onRelease);
        restoreObserver = () => {
          database.transaction = originalTransaction;
          pool.off("acquire", onAcquire); pool.off("release", onRelease);
          for (const [client, original] of patched) client.query = original;
        };
        return undefined;
      },
      afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
        const database = fixture.currency.control.drizzle;
        const scope = yield* Effect.tryPromise({ try: () =>
          fixture.currency.application.sessionAuthority.scopeMetadata.getScopeMetadataByDeploymentId(fixture.currency.deploymentId),
          catch: cause => commerceError("resourceFailure", cause) });
        if (scope === null) throw new Error("Missing installed fixture placement");
        const targetSchema = scope.physicalLocator.schemaName;
        const controlSchema = yield* Effect.tryPromise({ try: async () =>
          (await fixture.currency.control.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema,
          catch: cause => commerceError("resourceFailure", cause) });
        if (controlSchema === undefined) throw new Error("Missing installed control namespace");
        const namespace = changed.startsWith("control") ? controlSchema : targetSchema;
        if (changed === "controlPolicy") {
          checking = true;
          const rows = yield* borrowed.context.table("product").pipe(Effect.flatMap(store => store.find(borrowed.context.manager, {
            predicate: { kind: "in", column: "id", values: [fixture.seed.productId] },
            order: { column: "id", direction: "asc" },
          })));
          checking = false;
          expect(rows).toHaveLength(1);
          expect(installedTransactionProjections).toBe(1);
          expect(dataStatements).toBeGreaterThan(0);
          installedTransactionProjections = 0; dataStatements = 0;
        }
        const find = Effect.gen(function* () {
          checking = true;
          const clockRead = borrowed.context.transactionTime;
          if (changed.endsWith("ClockEpoch") && clockRead === undefined) throw new Error("Missing borrowed transaction time");
          const result = changed.endsWith("ClockEpoch") && clockRead !== undefined ? yield* Effect.result(clockRead) :
            yield* Effect.result(borrowed.context.table("product").pipe(Effect.flatMap(store => store.find(borrowed.context.manager, {
              // The positive control-policy witness already observed productId.
              // Select an unobserved valid identity to require actual storage.
              predicate: { kind: "in", column: "id", values: [changed === "controlPolicy"
                ? "prod_00000000000000000000000000" : fixture.seed.productId] },
              order: { column: "id", direction: "asc" },
            }))));
          checking = false;
          expect(altered).toBe(true);
          expect(result).toMatchObject({ _tag: "Failure" });
          expect(installedTransactionProjections).toBe(1);
          if (changed === "escapedPlacement") {
            const tx = escapedTransaction, managed = fixture.currency.managedRead;
            if (tx === undefined || managed === undefined) throw new Error("Missing escaped installed transaction");
            const refs = yield* getCoLocatedReadInstallationReferences(managed.readInstallation, fixture.currency.persistence.drizzle)
              .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
            expect(isManagedInstallationTransaction(tx, fixture.currency.persistence.drizzle, refs.targetInstallation)).toBe(false);
            expect(isManagedInstallationTransaction(tx, fixture.currency.persistence.drizzle, refs.controlInstallation)).toBe(false);
            expect(yield* Effect.result(requireCoLocatedInstallationAdmission(managed.readInstallation,
              fixture.currency.persistence.drizzle, tx))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidCapability" } });
          }
          checked = true;
          if (changed.endsWith("Epoch") && !changed.endsWith("ClockEpoch")) expect(dataStatements).toBeGreaterThan(0);
          else expect(dataStatements).toBe(0);
        });
        if (changed.endsWith("Maintenance")) {
          if (postgresUrl === null) throw new Error("Missing PostgreSQL integrity test connection");
          altered = true;
          yield* withInstallationMaintenance({ connectionString: postgresUrl }, namespace, () => find)
            .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
          return;
        }
        if (changed === "placement" || changed === "escapedPlacement") {
          yield* Effect.tryPromise({ try: async () => { await database.update(fxControlScopes).set({ physicalLocator: {
            ...scope.physicalLocator, schemaName: `${targetSchema}_wrong`,
          } }).where(and(eq(fxControlScopes.deploymentId, fixture.currency.deploymentId),
            eq(fxControlScopes.scopeId, fixture.activation.anchor.scopeId))); }, catch: cause => commerceError("resourceFailure", cause) });
          altered = true;
        } else if (changed === "controlNamespace") {
          yield* Effect.tryPromise({ try: async () => { await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation
            set schema_name = ${`${controlSchema}_wrong`} where singleton_id = 1`); },
            catch: cause => commerceError("resourceFailure", cause) });
          altered = true;
        } else if (changed.endsWith("Policy") || changed === "controlLogin" || changed === "controlIncarnation") {
          const login = yield* Effect.tryPromise({ try: async () =>
            (await fixture.currency.persistence.query<{ login: string }>("select session_user as login")).rows[0]?.login,
            catch: cause => commerceError("resourceFailure", cause) });
          if (login === undefined) throw new Error("Missing installed target login");
          const update = changed === "controlLogin" ? sql`login_oid = 0` :
            changed === "controlIncarnation" ? sql`incarnation = '00000000-0000-4000-8000-000000000001'::uuid` :
              sql`endpoint_policy = 'refused-finite-read'`;
          yield* Effect.tryPromise({ try: async () => { await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation_runtime
            set ${update} where login = ${login}`); }, catch: cause => commerceError("resourceFailure", cause) });
          altered = true;
        }
        yield* find;
      }),
    } });
    try {
      await fixture.runExecution().catch(() => undefined);
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      expect(altered).toBe(true);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, null))).rejects.toBeDefined();
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
    } finally { restoreObserver(); await fixture.close(); }
  }, 180_000);
});
