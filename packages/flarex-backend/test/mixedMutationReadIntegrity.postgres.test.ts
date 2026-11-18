import { and, DrizzleQueryError, eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { NodePgSession } from "drizzle-orm/node-postgres/session";
import { isNonArrayRecord } from "@flarex/utils/records";
import { fxControlScopes, fxSystemTransactionJournalReceipts } from "../../persistence-postgres/src/database/schema";
import { withInstallationMaintenance } from "../../persistence-postgres/src/database/postgresInstallationMaintenance";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { LogicalParticipantAdmissionError } from "../../persistence-postgres/src/storage/documents/logicalDocuments/participantErrors";
import { FiniteStorageCaptureError } from "../../persistence-postgres/src/execution/finiteStorageCapture";
import { createMixedMutationProductFixture, prepareMixedMutationPerformanceSeries } from "./support/mixedMutationWorkerdFixture";
import { getCoLocatedReadInstallationReferences, loadCoLocatedReadInstallation } from "../../persistence-postgres/src/installation/installationLifecycle";
import { prepareProtectedMetadata } from "../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import {
  createLocatedPointMutationSessionActivationTargetV1,
} from "@flarex/persistence-postgres/internal/session-construction";

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

  it.each(cases)("keeps command-local capture and fresh live-policy refusal across %s changes", async changed => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let checking = false, altered = false, checked = false, transactions = 0;
    let nativePreparations = 0, nativeExecutions = 0;
    let nativeFailure: unknown;
    let escapedSession: InstanceType<typeof NodePgSession> | undefined;
    type NativeCaptureKind = "indexPage" | "rows" | "transactionTime";
    const nativeOperations: NativeCaptureKind[] = [];
    const captures: Array<{ kind: NativeCaptureKind; reason: string; rows: number; indexes: number;
      targetMetadataEpoch: string | null; controlMetadataEpoch: string | null }> = [];
    const restores: Array<() => Promise<void>> = [];
    let afterCapture: Readonly<{ kind: NativeCaptureKind; run: () => Promise<void> }> | undefined;
    let restoreObserver = () => {};
    try {
      fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: `read-integrity-${changed}`, hooks: {
      onPreparedContext: async currency => {
        if (currency.resource.kind !== "postgres") throw new Error("Missing PostgreSQL capture observer");
        const database = currency.resource.target.drizzle;
        const prototype = NodePgSession.prototype;
        const prepareDescriptor = Object.getOwnPropertyDescriptor(prototype, "prepareQuery");
        const transactionDescriptor = Object.getOwnPropertyDescriptor(prototype, "transaction");
        if (prepareDescriptor === undefined || transactionDescriptor === undefined)
          throw new Error("Missing native session operations");
        restoreObserver = () => {
          Object.defineProperty(prototype, "prepareQuery", prepareDescriptor);
          Object.defineProperty(prototype, "transaction", transactionDescriptor);
        };
        prototype.transaction = new Proxy(prototype.transaction, { apply(original, receiver, args: unknown[]) {
          if (checking) transactions++;
          return Reflect.apply(original, receiver, args);
        } });
        prototype.prepareQuery = new Proxy(prototype.prepareQuery, { apply(original, receiver, args: unknown[]) {
          const statementName = args[2];
          if (!checking || typeof statementName !== "string" || !statementName.startsWith("fx_finite_"))
            return Reflect.apply(original, receiver, args);
          // The fixed native projection identifies the operation; only the
          // genuine mapper result establishes whether its body was released.
          const projection = args[1];
          if (!Array.isArray(projection)) throw new Error("Missing native finite capture projection");
          const rawFields: unknown[] = projection.flatMap(field => isNonArrayRecord(field) && Array.isArray(field.path) &&
            field.path.length === 2 && field.path[0] === "raw" ? [field.path[1]] : []);
          let kind: NativeCaptureKind;
          if (rawFields.includes("valueBytes")) kind = "rows";
          else if (rawFields.includes("encodedKeyBytes")) kind = "indexPage";
          else if (rawFields.length === 1 && rawFields[0] === "ordinal") kind = "transactionTime";
          else throw new Error("Unexpected native finite capture projection");
          if (!(receiver instanceof NodePgSession)) throw new Error("Missing genuine native capture session");
          nativePreparations++;
          nativeOperations.push(kind);
          expect(receiver).not.toBe(database._.session);
          escapedSession = receiver;
          const mapper = args[4];
          if (typeof mapper !== "function") throw new Error("Missing native finite result mapper");
          const observedMapper = new Proxy(mapper, { apply(map, mapperReceiver, rows: unknown[]) {
            const capture: unknown = Reflect.apply(map, mapperReceiver, rows);
            if (!isNonArrayRecord(capture) || !isNonArrayRecord(capture.header) ||
              typeof capture.header.reason !== "string" || !Array.isArray(capture.rawRows))
              throw new Error("Missing actual finite capture result");
            const targetMetadataEpoch: unknown = capture.header.targetMetadataEpoch;
            const controlMetadataEpoch: unknown = capture.header.controlMetadataEpoch;
            if (targetMetadataEpoch !== null && typeof targetMetadataEpoch !== "string" ||
              controlMetadataEpoch !== null && typeof controlMetadataEpoch !== "string")
              throw new Error("Missing actual finite capture metadata epochs");
            expect(capture.layoutFailure).toBeUndefined();
            if (kind === "transactionTime") expect(capture.header.transactionTimestamp).toEqual(expect.any(String));
            captures.push({ kind, reason: capture.header.reason, targetMetadataEpoch, controlMetadataEpoch,
              rows: capture.rawRows.filter(row => isNonArrayRecord(row) && Object.hasOwn(row, "valueBytes")).length,
              indexes: capture.rawRows.filter(row => isNonArrayRecord(row) && Object.hasOwn(row, "encodedKeyBytes")).length });
            return capture;
          } });
          const prepared: unknown = Reflect.apply(original, receiver, [...args.slice(0, 4), observedMapper, ...args.slice(5)]);
          if (!isNonArrayRecord(prepared)) throw new Error("Missing native prepared capture");
          return new Proxy(prepared, { get(target, property, preparedReceiver) {
            const operation: unknown = Reflect.get(target, property, preparedReceiver);
            if (property !== "execute" || typeof operation !== "function") return operation;
            return new Proxy(operation, { async apply(execute, _receiver, bindings: unknown[]) {
              nativeExecutions++;
              let capture: unknown;
              try { capture = await Reflect.apply(execute, target, bindings); }
              catch (cause) { nativeFailure = cause; throw cause; }
              const completed = afterCapture;
              if (completed !== undefined && completed.kind === kind) {
                expect(captures.at(-1)).toMatchObject({ kind, reason: "accepted" });
                afterCapture = undefined;
                await completed.run();
              }
              return capture;
            } });
          } });
        } });
        return undefined;
      },
      afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
        const database = fixture.currency.control.drizzle;
        const foreign = <Value>(run: () => Promise<Value>) => Effect.tryPromise({ try: run,
          catch: cause => commerceError("resourceFailure", cause) });
        const scope = yield* foreign(() => fixture.currency.application.sessionAuthority.scopeMetadata
          .getScopeMetadataByDeploymentId(fixture.currency.deploymentId));
        if (scope === null) throw new Error("Missing installed fixture placement");
        const targetSchema = scope.physicalLocator.schemaName;
        const controlSchema = yield* foreign(async () =>
          (await fixture.currency.control.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema);
        if (controlSchema === undefined) throw new Error("Missing installed control namespace");
        const namespace = changed.startsWith("control") ? controlSchema : targetSchema;
        const login = yield* foreign(async () =>
          (await fixture.currency.persistence.query<{ login: string }>("select session_user as login")).rows[0]?.login);
        if (login === undefined) throw new Error("Missing installed target login");
        // Maintenance changes installation identity and deletes runtime rows. Keep
        // exact pre-mutation server JSON, including timestamps and all logins.
        const quotedNamespace = `"${namespace.replaceAll('"', '""')}"`;
        const original = yield* foreign(async () => (await fixture.currency.control.query<{
          installation: unknown; runtimes: unknown; epoch: unknown;
        }>(`select (select to_jsonb(i) from ${quotedNamespace}.fx_system_installation i where singleton_id = 1) as installation,
          (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from ${quotedNamespace}.fx_system_installation_runtime r) as runtimes,
          (select to_jsonb(e) from ${quotedNamespace}.fx_system_prepared_metadata_epoch e where singleton_id = 1) as epoch`)).rows[0]);
        if (original === undefined || !isNonArrayRecord(original.epoch) ||
          typeof original.epoch.generation !== "number") throw new Error("Missing original installation metadata");
        const originalGeneration = original.epoch.generation;
        restores.push(async () => {
          await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation i set
            (database_name, schema_name, namespace_oid, incarnation, structural_generation, state,
              maintenance_owner, maintenance_pid, maintenance_backend_start) =
            (r.database_name, r.schema_name, r.namespace_oid, r.incarnation, r.structural_generation, r.state,
              r.maintenance_owner, r.maintenance_pid, r.maintenance_backend_start)
            from jsonb_populate_record(null::${sql.identifier(namespace)}.fx_system_installation,
              ${JSON.stringify(original.installation)}::jsonb) r where i.singleton_id = r.singleton_id`);
          await database.execute(sql`delete from ${sql.identifier(namespace)}.fx_system_installation_runtime`);
          await database.execute(sql`insert into ${sql.identifier(namespace)}.fx_system_installation_runtime
            select * from jsonb_populate_recordset(null::${sql.identifier(namespace)}.fx_system_installation_runtime,
              ${JSON.stringify(original.runtimes)}::jsonb)`);
          await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_prepared_metadata_epoch
            set generation = ${originalGeneration} where singleton_id = 1`);
        });
        const demandRows = (id: string) => borrowed.context.table("product").pipe(Effect.flatMap(store =>
          store.find(borrowed.context.manager, { predicate: { kind: "in", column: "id", values: [id] },
            order: { column: "id", direction: "asc" } })));
        const captured = <Value, Failure>(operation: Effect.Effect<Value, Failure>,
          expectedOperations: readonly NativeCaptureKind[] = ["indexPage"]) => Effect.gen(function* () {
          captures.length = 0;
          nativeOperations.length = 0;
          nativePreparations = 0; nativeExecutions = 0; nativeFailure = undefined;
          checking = true;
          const result = yield* Effect.result(operation).pipe(Effect.ensuring(Effect.sync(() => { checking = false; })));
          expect(transactions).toBe(0);
          expect(nativeOperations).toEqual(expectedOperations);
          expect(nativePreparations).toBe(expectedOperations.length);
          expect(nativeExecutions).toBe(expectedOperations.length);
          expect(captures).toHaveLength(changed === "controlMaintenance" || changed === "targetMaintenance"
            ? 0 : expectedOperations.length);
          return result;
        });
        const epochCase = changed.endsWith("Epoch");
        if (changed === "controlPolicy" || epochCase) {
          if (epochCase) afterCapture = { kind: changed.endsWith("ClockEpoch") ? "transactionTime" : "rows",
            run: async () => {
              // Preserve the post-mapper boundary after the command's last
              // capture: Product membership is followed by a separate row body.
              await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_prepared_metadata_epoch
                set generation = generation + 1 where singleton_id = 1`);
              const current = (await fixture.currency.control.query<{ generation: string }>(
                `select generation::text from ${quotedNamespace}.fx_system_prepared_metadata_epoch where singleton_id = 1`)).rows[0];
              expect(current?.generation).toBe(String(originalGeneration + 1));
              altered = true;
            } };
          const time = borrowed.context.transactionTime;
          if (changed.endsWith("ClockEpoch") && time === undefined) throw new Error("Missing borrowed transaction time");
          if (changed.endsWith("ClockEpoch") && time !== undefined) {
            const positive = yield* captured(time, ["transactionTime"]);
            if (!Result.isSuccess(positive)) throw new Error("Expected successful native transaction time capture");
          } else {
            const positive = yield* captured(demandRows(fixture.seed.productId), ["indexPage", "rows"]);
            if (!Result.isSuccess(positive)) throw new Error("Expected successful native Product row capture");
            expect(positive.success).toHaveLength(1);
            expect(positive.success).toMatchObject([{ id: fixture.seed.productId }]);
            expect(captures[0]).toMatchObject({ kind: "indexPage", rows: 0 });
            expect(captures[0]?.indexes).toBeGreaterThan(0);
            expect(captures[1]).toMatchObject({ kind: "rows", indexes: 0 });
            expect(captures[1]?.rows).toBeGreaterThan(0);
          }
          expect(captures.every(capture => capture.reason === "accepted")).toBe(true);
          expect(afterCapture).toBeUndefined();
        }
        if (epochCase) {
          // A new command observes the publication's current epoch. Ordinary
          // storage reads retain no unchanged-since-entry epoch requirement.
          const fresh = yield* captured(demandRows("prod_00000000000000000000000000"));
          if (!Result.isSuccess(fresh)) throw new Error("Expected successful fresh capture after epoch publication");
          expect(fresh.success).toEqual([]);
          expect(captures[0]).toMatchObject({ kind: "indexPage", reason: "accepted", rows: 0, indexes: 0 });
          expect(changed.startsWith("control") ? captures[0]?.controlMetadataEpoch : captures[0]?.targetMetadataEpoch)
            .toBe(String(originalGeneration + 1));
          yield* foreign(async () => { await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation_runtime
            set endpoint_policy = 'refused-finite-read' where login = ${login}`); });
        }
        const refuse = Effect.gen(function* () {
          // An unobserved identity forces a new capture after live-policy change;
          // epoch cases use a second missing identity after their accepted read.
          const result = yield* captured(demandRows(epochCase ? "prod_00000000000000000000000001" :
            changed === "controlPolicy" ? "prod_00000000000000000000000000" : fixture.seed.productId));
          expect(altered).toBe(true);
          expect(result).toMatchObject({ _tag: "Failure" });
          if (changed === "controlMaintenance" || changed === "targetMaintenance") {
            if (!Result.isFailure(result)) throw new Error("Expected native installation maintenance refusal");
            expect(result.failure.reason).toBe("resourceFailure");
            const participantFailure = result.failure.cause;
            if (!(participantFailure instanceof LogicalParticipantAdmissionError))
              throw new Error("Missing original participant maintenance failure");
            expect(participantFailure.reason).toBe("resourceFailure");
            const captureFailure = participantFailure.cause;
            if (!(captureFailure instanceof FiniteStorageCaptureError))
              throw new Error("Missing original finite capture maintenance failure");
            expect(captureFailure.reason).toBe("resourceFailure");
            expect(captureFailure.cause).toBe(nativeFailure);
            if (!(nativeFailure instanceof DrizzleQueryError)) throw new Error("Missing original native query rejection");
            expect(nativeFailure.cause).toMatchObject({ code: "55P03", message: "Installation maintenance admission is busy" });
            // The exclusive maintenance latch refuses the genuine dispatched
            // statement before a result mapper can release a business envelope.
            expect(captures).toHaveLength(0);
          } else {
            expect(captures[0]?.reason).not.toBe("accepted");
            expect(captures[0]).toMatchObject({ rows: 0, indexes: 0 });
          }
          if (changed === "escapedPlacement") {
            const session = escapedSession;
            if (session === undefined) throw new Error("Missing actual expired capture session");
            const expired = yield* Effect.result(foreign(() => session.prepareQuery({ sql: "select 1", params: [] },
              undefined, undefined, false).execute()));
            expect(expired).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure" } });
            if (Result.isFailure(expired)) expect(expired.failure.cause).toMatchObject({
              cause: { message: "PostgreSQL physical session callback work is closed." },
            });
          }
          checked = true;
        });
        if (changed.endsWith("Maintenance")) {
          if (postgresUrl === null) throw new Error("Missing PostgreSQL integrity test connection");
          altered = true;
          yield* withInstallationMaintenance({ connectionString: postgresUrl }, namespace, () => refuse)
            .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
          return;
        }
        if (changed === "placement" || changed === "escapedPlacement") {
          restores.push(async () => { await database.update(fxControlScopes).set({ physicalLocator: scope.physicalLocator })
            .where(and(eq(fxControlScopes.deploymentId, fixture.currency.deploymentId),
              eq(fxControlScopes.scopeId, fixture.activation.anchor.scopeId))); });
          yield* foreign(async () => { await database.update(fxControlScopes).set({ physicalLocator: {
            ...scope.physicalLocator, schemaName: `${targetSchema}_wrong`,
          } }).where(and(eq(fxControlScopes.deploymentId, fixture.currency.deploymentId),
            eq(fxControlScopes.scopeId, fixture.activation.anchor.scopeId))); });
          altered = true;
        } else if (changed === "controlNamespace") {
          yield* foreign(async () => { await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation
            set schema_name = ${`${controlSchema}_wrong`} where singleton_id = 1`); });
          altered = true;
        } else if (changed === "controlPolicy" || changed === "targetPolicy" ||
          changed === "controlLogin" || changed === "controlIncarnation") {
          const update = changed === "controlLogin" ? sql`login_oid = 0` :
            changed === "controlIncarnation" ? sql`incarnation = '00000000-0000-4000-8000-000000000001'::uuid` :
              sql`endpoint_policy = 'refused-finite-read'`;
          yield* foreign(async () => { await database.execute(sql`update ${sql.identifier(namespace)}.fx_system_installation_runtime
            set ${update} where login = ${login}`); });
          altered = true;
        }
        yield* refuse;
      }),
      } });
    } catch (cause) {
      try { restoreObserver(); }
      catch (restorationCause) { throw new AggregateError([cause, restorationCause],
        "Read integrity fixture construction and observer restoration failed"); }
      throw cause;
    }
    try {
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      expect(altered).toBe(true);
      await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(fixture.attempt, null))).rejects.toBeDefined();
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
    } finally {
      restoreObserver();
      const cleanupFailures: unknown[] = [];
      for (const restore of restores.toReversed()) {
        try { await restore(); }
        catch (cause) { cleanupFailures.push(cause); }
      }
      try { await fixture.close(); }
      catch (cause) { cleanupFailures.push(cause); }
      if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures,
        "Read integrity fixture restoration and cleanup failed");
    }
  }, 180_000);
});
