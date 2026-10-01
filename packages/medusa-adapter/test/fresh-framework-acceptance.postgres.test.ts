import { Cause, Deferred, Effect, Exit, Fiber, Tracer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { defineCmsCommand, makeCmsHost } from "../../persistence-postgres/src/cmsTransaction/host";
import { cmsError } from "../../persistence-postgres/src/cmsTransaction/model";
import { issueRelationalSession, runRelationalSession, makePostgresRelationalSession } from
  "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../../persistence-postgres/src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../../persistence-postgres/src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../persistence-postgres/src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../../persistence-postgres/src/appSchemaCandidateValidation";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { assertProtectedGuardFailure } from "./support/protected-acceptance-observation";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "native framework work under protected Application acceptance", () => {
    const cleanup: Array<() => Promise<void>> = [];
    let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
    let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
    const names: string[] = [];
    const guardsObserved: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({ span(options) {
      names.push(options.name);
      const span = new Tracer.NativeSpan(options);
      if (options.name === "PreparedMetadataEpoch.guard") guardsObserved.push(span);
      return span;
    } });
    const traced = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.withTracer(tracer)));
    const invalidate = "update fx_system_application_function_v1 set function_path = function_path where false";
    beforeAll(async () => {
      fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close),
        { protectedRuntime: true, includeProduct: true });
      product = await prepareLogicalProductHost(fixture);
      cleanup.push(() => Effect.runPromise(product.host.close));
    }, 180_000);
    afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

    it("charges direct Product initialization, native command, read and replay to the success guard", async () => {
      const host = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
        commands: [product.runtime.commands.internalProductCreate, product.runtime.commands.retrieve] }));
      try {
        const key = host.newRequestKey();
        const input = { id: "prod_protected_acceptance", title: "Protected Product", handle: "protected-acceptance" };
        const outputs: unknown[] = [];
        for (const work of [host.initialize([]), host.run(key, product.runtime.commands.internalProductCreate, input),
          host.read(product.runtime.commands.retrieve, { id: input.id, config: { select: ["id", "title"] } }),
          host.run(key, product.runtime.commands.internalProductCreate, input)]) {
          const guards = names.filter(name => name === "PreparedMetadataEpoch.guard").length;
          outputs.push(await traced(work));
          expect(names.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(1);
        }
        expect(outputs[2]).toStrictEqual({ id: input.id, title: input.title });
        expect(names.filter(name => name === "ProductAdapter.internalProduct.create")).toHaveLength(1);
      } finally { await Effect.runPromise(host.close); }
    });

    it("commits actual atomic Product rows, events and outcome under its ordinary full-live profile", async () => {
      let activeTx: FlarexMetadataTransaction | undefined;
      let commitAttempts = 0;
      if (fixture.resource.kind !== "postgres") throw new Error("Expected protected PostgreSQL fixture");
      const physical = makePostgresRelationalSession(fixture.resource.target, { lifecycleFault: event => {
        if (event.phase === "commit" && event.edge === "before") commitAttempts++;
      } });
      const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work, commandMs) =>
        runRelationalSession(physical, profile, tx => {
          activeTx = tx;
          return work(tx).pipe(Effect.ensuring(Effect.sync(() => { activeTx = undefined; })));
        }, commandMs).pipe(Effect.catchTag("RelationalTransactionError", cause =>
          Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
      const participant = defineAtomicCommerceParticipant("protectedProduct");
      const event = defineCommerceEventContract({ name: product.runtime.metadata.tag.createdEvent,
        revision: "a".repeat(64), internal: true, decode: product.runtime.logicalPolicy.capture });
      let nativeCompleted = 0;
      const command = defineAtomicCommerceCommand("protectedProductMetadataWriter", (ctx, args) =>
        ctx.call(participant, product.runtime.commands.createTags, args).pipe(Effect.flatMap(result => Effect.gen(function* () {
          nativeCompleted++;
          if (activeTx === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          yield* runDrizzleStatementEffect(activeTx.execute(invalidate), cause => commerceError("statementFailure", cause));
          return result;
        }))));
      const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, session,
        participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
          commands: [product.runtime.commands.createTags], validateLogicalCall: product.runtime.logicalPolicy.validateLogicalCall,
          events: { contracts: [event], select: value => isJsonObject(value) &&
            value.name === product.runtime.metadata.tag.createdEvent ? Effect.succeed(event)
            : Effect.fail(commerceError("unadmittedEvent")) } }], commands: [command],
        events: { producerRevision: "b".repeat(64), contracts: [event],
          subscribers: [{ id: "protected-product-events", revision: "c".repeat(64) }],
          validate: events => events.some(value => !value.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
      try {
        const before = await logicalCurrencyInventory(fixture);
        const guardsBefore = guardsObserved.length;
        const result = await traced(Effect.exit(host.run(host.newRequestKey(), command,
          { id: "ptag_live_acceptance", value: "Ordinary native event" })));
        // This independent atomic host prepares its sources as retained/full-live
        // bindings. Epoch-only invalidation cannot invalidate unchanged bodies;
        // it does not open the journal-backed finite global guard scope.
        expect(Exit.isSuccess(result)).toBe(true);
        if (Exit.isSuccess(result)) expect(result.value).toMatchObject({ id: "ptag_live_acceptance" });
        expect(nativeCompleted).toBe(1);
        expect(guardsObserved.length - guardsBefore).toBe(0);
        expect(commitAttempts).toBe(1);
        expect(activeTx).toBeUndefined();
        const after = await logicalCurrencyInventory(fixture);
        expect(after.rows.length).toBeGreaterThan(before.rows.length);
        expect(after.revisions.length).toBeGreaterThan(before.revisions.length);
        expect(after.rowChanges.length).toBeGreaterThan(before.rowChanges.length);
        expect(after.events.length).toBeGreaterThan(before.events.length);
        expect(after.outcomes.length).toBeGreaterThan(before.outcomes.length);
      } finally { await Effect.runPromise(host.close); }
    });

    it("runs actual logical Payload Local API work but refuses publication at the direct tail", async () => {
      await traced(Effect.scoped(Effect.gen(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]);
        const runtime = yield* makePayloadRuntime(compiled);
        let activeTx: FlarexMetadataTransaction | undefined;
        let commitAttempts = 0;
        if (fixture.resource.kind !== "postgres") throw new Error("Expected protected PostgreSQL fixture");
        const physical = makePostgresRelationalSession(fixture.resource.target, { lifecycleFault: event => {
          if (event.phase === "commit" && event.edge === "before") commitAttempts++;
        } });
        const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work, commandMs) =>
          runRelationalSession(physical, profile, tx => {
            activeTx = tx;
            return work(tx).pipe(Effect.ensuring(Effect.sync(() => { activeTx = undefined; })));
          }, commandMs).pipe(Effect.catchTag("RelationalTransactionError", cause =>
            Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
        const input = { hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
          database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
          deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
          authority: fixture.application.authorityPorts, application: fixture.application.activation,
          identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api", hook: "none" },
          logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts },
            unique: fixture.application.uniqueConstraintEligibility, schemaVersionId: fixture.schemaVersionId,
            source: compiled.sourceContract },
          materialization: {
            intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
            developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
            uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
            candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({
              candidateValidation: fixture.application.candidateValidation, pointCommitAuthority: fixture.application.sessionAuthority }),
          }, commands: Object.values(runtime.commands), expectedContentIdentity: compiled.contentIdentity };
        let nativeClosure = 0;
        const host = yield* makeCmsHost(input, { afterDocumentClosure: () => Effect.gen(function* () {
          nativeClosure++;
          if (activeTx === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
          yield* runDrizzleStatementEffect(activeTx.execute(invalidate), cause => cmsError("statementFailure", cause));
        }) });
        const before = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
        const guards = names.filter(name => name === "PreparedMetadataEpoch.guard").length;
        try {
          const result = yield* Effect.exit(host.run(host.newRequestKey(), runtime.commands.create,
            { collection: "news", data: { title: "Tentative Local API" } }));
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) expect(result.cause.reasons.every(reason => !Cause.isDieReason(reason))).toBe(true);
          expect(nativeClosure).toBe(1);
          expect(names.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(1);
          assertProtectedGuardFailure(guardsObserved.at(-1), ["changed"]);
          expect(commitAttempts).toBe(0);
          expect(activeTx).toBeUndefined();
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(before);
        } finally { yield* host.close; }

        let nativeCalls = 0;
        const create = defineCmsCommand({ name: "protectedPayloadCreate", mode: "write", run: (ctx, args) => {
          nativeCalls++;
          return ctx.nested(runtime.commands.create, args);
        } });
        const selectedInput = { ...input, commands: [...input.commands, create] };
        const entered = yield* Deferred.make<void>();
        const cancelled = yield* makeCmsHost(selectedInput, { afterDocumentClosure: () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)) });
        try {
          const beforeCancellation = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          const fiber = yield* cancelled.run(cancelled.newRequestKey(), create,
            { collection: "news", data: { title: "Cancelled native Local API" } }).pipe(Effect.forkChild);
          try {
            yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"), Effect.orDie);
            yield* Fiber.interrupt(fiber);
            const result = yield* Fiber.await(fiber);
            expect(Exit.isFailure(result)).toBe(true);
            expect(nativeCalls).toBe(1);
            expect(activeTx).toBeUndefined();
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(beforeCancellation);
          } finally { yield* Fiber.interrupt(fiber); }
        } finally { yield* cancelled.close; }

        nativeCalls = 0;
        let lostAcknowledgement = false;
        const recoveringSession = makePostgresRelationalSession(fixture.resource.target, { lifecycleFault: event => {
          if (!lostAcknowledgement && event.phase === "commit" && event.edge === "after") {
            lostAcknowledgement = true;
            throw new Error("Lost protected Payload COMMIT acknowledgement");
          }
        } });
        const recovering = yield* makeCmsHost({ ...selectedInput, session: recoveringSession });
        try {
          const key = recovering.newRequestKey();
          const args = { collection: "news", data: { title: "Recovered protected Local API" } };
          const guards = names.filter(name => name === "PreparedMetadataEpoch.guard").length;
          const result = yield* recovering.run(key, create, args);
          expect(result).toMatchObject({ title: args.data.title });
          expect(lostAcknowledgement).toBe(true);
          expect(nativeCalls).toBe(1);
          expect(names.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(2);
          const committed = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(yield* recovering.run(key, create, args)).toEqual(result);
          expect(nativeCalls).toBe(1);
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(committed);
        } finally { yield* recovering.close; }
      })));
    });
  });
