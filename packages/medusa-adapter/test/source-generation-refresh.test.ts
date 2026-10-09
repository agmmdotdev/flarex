import { sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Tracer } from "effect";
import { expect, it } from "vitest";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { defineCmsCommand } from "../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import { makeCmsHost } from "../../persistence-postgres/src/frameworks/cmsTransaction/host";
import type { CmsTransactionError } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import type { CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { closeInstallationAdmission, getCoLocatedReadInstallationReferencesResult } from "../../persistence-postgres/src/installation/installationLifecycle";
import { acquireProtectedMetadataInstallationAdmission, captureProtectedMetadataEpoch, guardProtectedMetadataEpoch, prepareProtectedMetadata } from "../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import { fxControlIndexDefinitions, fxSystemApplicationReadinessV1 } from "../../persistence-postgres/src/database/schema";
import { composeRelationReadinessFixtureRuntime } from "../../persistence-postgres/test/application/relations/applicationRelationReadinessFixture";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { currencyCommands, withCurrencyService } from "../src/currency-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

for (const driver of ["pglite", "postgres"] as const) for (const family of ["CMS", "Commerce", "AtomicCommerce"] as const) {
  it.skipIf(driver === "postgres" && (postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL))(
    `refreshes the original ${family} source generation before business on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close),
          driver === "postgres" ? { managedRead: true } : undefined);
        const managed = fixture.managedRead;
        const control = managed?.control ?? fixture.control;
        const db = fixture.persistence.drizzle;
        const protectedPair = managed === undefined ? undefined : Result.getOrThrow(
          getCoLocatedReadInstallationReferencesResult(managed.readInstallation, db));
        const controlProtection = protectedPair === undefined ? undefined : await Effect.runPromise(
          prepareProtectedMetadata(db, protectedPair.controlInstallation));
        const targetProtection = managed === undefined ? undefined : await Effect.runPromise(prepareProtectedMetadata(db, managed.installation));
        const oldProtection = await Promise.all(([{ token: targetProtection, database: db },
          { token: controlProtection, database: db }] as const).map(async member => {
          if (member.token === undefined) return undefined;
          const token = member.token;
          const epoch = await member.database.transaction(async tx => {
            await Effect.runPromise(acquireProtectedMetadataInstallationAdmission(token, member.database, tx));
            try { return await Effect.runPromise(captureProtectedMetadataEpoch(token, member.database, tx)); }
            finally { closeInstallationAdmission(tx); }
          });
          return { ...member, token, epoch };
        }));
        const physicalLocator = fixture.application.active.basis.authority.physicalLocator;
        if (physicalLocator.kind === "shared_database") throw new Error("Source generation fixture requires an original split locator");
        const runtime = fixture.resource.kind === "postgres" && managed !== undefined && controlProtection !== undefined
          ? composeRelationReadinessFixtureRuntime(control, fixture.resource.target, {
            deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
            physicalLocator, bindingAdmission: true,
            sessionTargetOptions: { managedInstallation: { installation: managed.readInstallation, controlProtection } },
            ...(fixture.resource.activationProfile === undefined ? {} : { activationProfile: fixture.resource.activationProfile }),
            ...(targetProtection === undefined ? {} : { protectedMetadata: { database: db, token: targetProtection } }),
            coldRuntime: { runtimeHostIdentity: "flarex.test/logical-currency", compatibilityDate: "2026-09-20" },
          }) : undefined;
        const authority = runtime?.authorityPorts ?? fixture.application.authorityPorts;
        const application = runtime?.relationActivation ?? fixture.application.activation;
        const unique = runtime?.uniqueConstraintEligibility ?? fixture.application.uniqueConstraintEligibility;
        if (driver === "postgres") {
          const ownerLogin = (await fixture.testOwner.query<{ login: string }>("select session_user as login")).rows[0]?.login;
          if (ownerLogin === undefined) throw new Error("Missing original fixture owner login");
          for (const persistence of [fixture.persistence, control]) {
            const role = (await persistence.query<{ login: string; superuser: boolean; bypass: boolean }>(
              `select session_user as login, rolsuper as superuser, rolbypassrls as bypass
               from pg_roles where rolname=session_user`)).rows[0];
            expect(role).toMatchObject({ superuser: false, bypass: false });
            expect(role?.login).not.toBe(ownerLogin);
          }
        }
        const spans: string[] = [];
        const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
        const run = <A, E>(work: Effect.Effect<A, E>) => Effect.runPromise(work.pipe(Effect.provideService(Tracer.Tracer, tracer)));
        let callbacks = 0;
        let rootCallbacks = 0;
        let cancelAfterWrite = false;
        const enteredCancellation = await Effect.runPromise(Deferred.make<void>());
        const afterWrite = (value: Json) => cancelAfterWrite ? Deferred.succeed(enteredCancellation, undefined).pipe(
          Effect.andThen(Effect.never)) : Effect.succeed(value);
        const cmsWrite = defineCmsCommand({ name: "sourceGenerationInsert", mode: "write", run: (ctx, args) => {
          callbacks++;
          return ctx.documents.insert(ctx.context, ctx.transactionId, "news", args).pipe(Effect.flatMap(afterWrite));
        } });
        const cmsRead = defineCmsCommand({ name: "sourceGenerationRead", mode: "read", run: (ctx, args) =>
          ctx.documents.get(ctx.context, ctx.transactionId, String(args)) });
        const commerceWrite = defineCommerceCommand("sourceGenerationUpsert", "write", (ctx, args) => {
          callbacks++;
          if (!isJsonObject(args) || typeof args.code !== "string") throw new Error("Invalid fixture Currency input");
          const code = args.code;
          return withCurrencyService(ctx, async ({ internal, service, context }) => {
            await internal.upsert([args], context);
            return service.retrieveCurrency(code, {}, context);
          }).pipe(Effect.flatMap(afterWrite));
        });
        const currencyParticipant = defineAtomicCommerceParticipant("currency");
        const atomicWrite = defineAtomicCommerceCommand("sourceGenerationAtomicUpsert", (ctx, args) => {
          rootCallbacks++;
          return ctx.call(currencyParticipant, commerceWrite, args);
        });
        const compiled = await Effect.runPromise(compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]));
        const selected = family === "CMS" ? { family: "CMS" as const, host: await run(makeCmsHost({ hostRuntime: preparedHostTestRuntime(db), database: db,
          controlDatabase: control.drizzle, session: fixture.session, deploymentId: fixture.deploymentId,
          scopeId: fixture.application.authority.scopeId, authority, application,
          commands: [cmsWrite, cmsRead], identityAndAccessPolicy: { profile: "source-generation" }, materialization: {},
          expectedContentIdentity: compiled.contentIdentity, logicalStorage: { ports: { controlDb: control.drizzle, authority }, unique,
            schemaVersionId: fixture.schemaVersionId, source: compiled.sourceContract },
        })) } : family === "Commerce" ? { family: "Commerce" as const, host: await run(makeCommerceHost({ ...fixture.hostInput, authority, application, commands: [commerceWrite, ...Object.values(currencyCommands)],
          logicalStorage: { ...fixture.hostInput.logicalStorage, ports: { controlDb: control.drizzle, authority }, unique },
        })) } : { family: "AtomicCommerce" as const, host: await run(makeAtomicCommerceHost({
          hostRuntime: fixture.hostInput.hostRuntime, database: db, session: fixture.session,
          target: fixture.hostInput.target, deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
          authority, application, identityAndAccessPolicy: { profile: "source-generation-atomic" },
          participants: [{ participant: currencyParticipant, commands: [commerceWrite],
            logicalStorage: { ...fixture.hostInput.logicalStorage, ports: { controlDb: control.drizzle, authority }, unique } }],
          commands: [atomicWrite],
        })) };
        cleanup.push(() => Effect.runPromise(selected.host.close));
        const sourcePreparations = () => spans.filter(name => name === "LogicalStorageReadiness.prepare").length;
        const write = (key: string, args: Json): Effect.Effect<Json, CmsTransactionError | CommerceTransactionError> =>
          selected.family === "CMS" ? selected.host.run(key, cmsWrite, args) : selected.family === "Commerce" ?
            selected.host.run(key, commerceWrite, args) : selected.host.run(key, atomicWrite, args);
        const expectCallbacks = (count: number) => {
          expect(callbacks).toBe(count);
          if (selected.family === "AtomicCommerce") expect(rootCallbacks).toBe(count);
        };
        const makeArgs = (step: number) => family === "CMS" ? { title: `source-generation-${step}`,
          createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" } :
          { code: "usd", name: `Generation ${step}`, symbol: "$", symbol_native: "$", decimal_digits: 2, rounding: 0 };
        for (let step = 0; step < 3; step++) {
          if (step === 1) await fixture.control.drizzle.update(fxControlIndexDefinitions)
            .set({ physicalSpecCodecVersion: sql`${fxControlIndexDefinitions.physicalSpecCodecVersion}` }).where(sql`false`);
          if (step === 2) await fixture.testOwner.drizzle.update(fxSystemApplicationReadinessV1)
            .set({ runtimeHostIdentity: sql`${fxSystemApplicationReadinessV1.runtimeHostIdentity}` }).where(sql`false`);
          const key = selected.host.newRequestKey();
          const args = makeArgs(step);
          const value = await run(write(key, args));
          expectCallbacks(step + 1);
          expect(await run(write(key, args))).toEqual(value);
          expectCallbacks(step + 1);
          if (selected.family === "CMS") {
            if (!isJsonObject(value) || typeof value._id !== "string") throw new Error("Missing original CMS document id");
            expect(await run(selected.host.read(cmsRead, value._id))).toEqual(value);
          } else if (selected.family === "Commerce") expect(await run(selected.host.read(currencyCommands.retrieve, { code: "usd" }))).toEqual(value);
          // Independent durable verification uses the fixture's genuine native
          // Commerce host; its preparation is outside the observed Atomic host.
          else expect(await Effect.runPromise(fixture.host.read(currencyCommands.retrieve, { code: "usd" }))).toEqual(value);
          expect(sourcePreparations()).toBe(driver === "postgres" ? step + 1 : 1);
          const staticReplays = spans.filter(name => name === "LogicalStorageReadiness.validateCatalogSnapshot").length;
          if (driver === "postgres") expect(staticReplays).toBe(0);
          else expect(staticReplays).toBeGreaterThan(0);
          const stale = step === 1 ? oldProtection[1] : step === 2 ? oldProtection[0] : undefined;
          if (stale !== undefined) await expect(stale.database.transaction(async tx => {
            await Effect.runPromise(acquireProtectedMetadataInstallationAdmission(stale.token, stale.database, tx));
            try { await Effect.runPromise(guardProtectedMetadataEpoch(stale.token, stale.database, stale.epoch, tx)); }
            finally { closeInstallationAdmission(tx); }
          })).rejects.toMatchObject({ reason: "changed" });
        }
        const beforeCancellation = await logicalCurrencyInventory(fixture);
        const cancelledKey = selected.host.newRequestKey();
        cancelAfterWrite = true;
        const cancelWork = write(cancelledKey, makeArgs(3));
        const cancelledFiber = Effect.runFork(cancelWork.pipe(Effect.provideService(Tracer.Tracer, tracer)));
        await Effect.runPromise(Deferred.await(enteredCancellation));
        await Effect.runPromise(Fiber.interrupt(cancelledFiber));
        const cancelled = await Effect.runPromise(Fiber.await(cancelledFiber));
        if (Exit.isSuccess(cancelled)) throw new Error("Source command cancellation unexpectedly succeeded");
        expect(Cause.hasInterruptsOnly(cancelled.cause)).toBe(true);
        expectCallbacks(4);
        expect(await logicalCurrencyInventory(fixture)).toEqual(beforeCancellation);
        cancelAfterWrite = false;
        const retry = await run(write(cancelledKey, makeArgs(3)));
        expectCallbacks(5);
        expect(await run(write(cancelledKey, makeArgs(3)))).toEqual(retry);
        expectCallbacks(5);
        expect(sourcePreparations()).toBe(driver === "postgres" ? 3 : 1);
      } finally { for (const close of cleanup.reverse()) await close(); }
    }, 180_000);
}
