import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { prepareLogicalDocumentSourceAdmission, requireLogicalDocumentSourceAdmission,
  type LogicalDocumentSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/documentAdmission";
import { makeSourceCmsDocuments, consumeSourceCmsDocumentClosure } from "../../persistence-postgres/src/cmsTransaction/documents";
import { prepareSourceCmsDocumentDelta, validateSourceCmsDocumentContribution } from "../../persistence-postgres/src/cmsTransaction/contribution";
import { cmsError, cmsLimits } from "../../persistence-postgres/src/cmsTransaction/model";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { defineCmsCommand, makeCmsHost } from "../../persistence-postgres/src/cmsTransaction/host";
import { DataBindingError } from "../../persistence-postgres/src/frameworkSchema/binding/errors";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../persistence-postgres/src/scopeAuthorityResolution";
import { prepareLogicalApplicationSourceAdmission, requireLogicalApplicationSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/applicationAdmission";
import { makeSourceApplicationInsertParticipant, applicationCommandError } from "../../persistence-postgres/src/applicationDocumentMaterialization/insertParticipant";
import { lockScopeClockForUpdateInTransactionEffect } from "../../persistence-postgres/src/scopeClock";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/drizzleStatementEffect";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { currencyAnnouncementWrite, currencyCommands } from "../src/currency-service";
import { withCurrencyService } from "../src/currency-service";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

describe("native Currency on the selected shared logical schema", () => {
  it("refuses an unbound logical Currency source and resumes after rebinding on PGlite", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("pglite", close => cleanup.push(close));
      const bindingBase = { database: fixture.persistence.drizzle,
        selection: { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId },
        target: fixture.bindingTarget, authority: fixture.application.authorityPorts,
        application: fixture.application.activation };
      const input = { ...bindingBase,
        logicalStorage: { controlDb: fixture.control.drizzle, schemaVersionId: fixture.schemaVersionId,
          unique: fixture.application.uniqueConstraintEligibility } };
      const configured = await Effect.runPromise(makeDataBindingHost(input));
      const unconfigured = await Effect.runPromise(makeDataBindingHost(bindingBase));
      const original = await Effect.runPromise(configured.withCurrent(readAdmittedDataBinding));
      const query = { filters: { code: "usd" }, config: { select: ["code", "name"] } };
      const before = await Effect.runPromise(fixture.host.read(currencyCommands.list, query));
      const durableBefore = await logicalCurrencyInventory(fixture);
      let unbound = false;
      try {
        const candidate = await Effect.runPromise(unconfigured.prepare({ ...original.frame, logicalSchema: null }));
        await Effect.runPromise(unconfigured.activate(dataBindingActivationRequest(original.frame.application.scopeId,
          original.frame.application.storageGeneration, "pglite-logical-unbind", candidate.sha256, original.head)));
        unbound = true;
        await expect(Effect.runPromise(fixture.host.read(currencyCommands.list, query)))
          .rejects.toMatchObject({ reason: "bindingChanged" });
        expect(await logicalCurrencyInventory(fixture)).toEqual(durableBefore);
      } finally {
        if (unbound) {
          const current = await Effect.runPromise(unconfigured.withCurrent(readAdmittedDataBinding));
          const candidate = await Effect.runPromise(configured.prepare(original.frame));
          await Effect.runPromise(configured.activate(dataBindingActivationRequest(original.frame.application.scopeId,
            original.frame.application.storageGeneration, "pglite-logical-rebind", candidate.sha256, current.head)));
        }
      }
      expect(await Effect.runPromise(fixture.host.read(currencyCommands.list, query))).toEqual(before);
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 180_000);

  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(`admits independently compiled Payload in the same candidate on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        const db = fixture.persistence.drizzle;
        const before = await db.select().from(fxAppRowCurrent);
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
            { name: "title", type: "text", required: true, unique: true },
          ] }]);
          const source = compiled.sourceContract;
          const input = { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
            schemaVersionId: fixture.schemaVersionId };
          const ports = { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts };
          const outage = new DOMException("Payload policy digest unavailable", "OperationError");
          const unavailable = yield* Effect.acquireUseRelease(
            Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(outage)),
            () => Effect.result(prepareLogicalDocumentSourceAdmission(ports,
              fixture.application.uniqueConstraintEligibility, input, source)),
            digest => Effect.sync(() => digest.mockRestore()));
          expect(unavailable).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure",
            cause: { reason: "digestUnavailable" } } });
          const digestDefect = new Error("Unexpected digest defect");
          const defectivePreparation = yield* Effect.acquireUseRelease(
            Effect.sync(() => vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(digestDefect)),
            () => Effect.exit(prepareLogicalDocumentSourceAdmission(ports,
              fixture.application.uniqueConstraintEligibility, input, source)),
            digest => Effect.sync(() => digest.mockRestore()));
          expect(Exit.isFailure(defectivePreparation)).toBe(true);
          if (Exit.isFailure(defectivePreparation)) expect(defectivePreparation.cause.reasons.some(reason =>
            Cause.isDieReason(reason) && reason.defect === digestDefect)).toBe(true);
          const mutablePorts = { ...ports };
          const mutableInput = { ...input };
          const select = fixture.control.drizzle.select.bind(fixture.control.drizzle);
          const prepared = yield* Effect.acquireUseRelease(
            Effect.sync(() => vi.spyOn(fixture.control.drizzle, "select").mockImplementationOnce(fields => {
              mutablePorts.controlDb = db;
              mutableInput.deploymentId = "changed-deployment";
              mutableInput.schemaVersionId = decodeCatalogSchemaVersionId("changed-payload-version");
              return select(fields);
            })),
            () => prepareLogicalDocumentSourceAdmission(mutablePorts,
              fixture.application.uniqueConstraintEligibility, mutableInput, source),
            firstRead => Effect.sync(() => firstRead.mockRestore()));
          expect(yield* Effect.result(prepareLogicalDocumentSourceAdmission(ports,
            fixture.application.uniqueConstraintEligibility, input, { ...source, evidence: {} })))
            .toMatchObject({ _tag: "Failure", failure: { reason: "sourceMismatch" } });
          const active = yield* fixture.application.activation.readActive();
          const mutableAppPorts = { ...ports };
          const mutableAppInput = { ...input };
          const appSource = yield* Effect.acquireUseRelease(
            Effect.sync(() => vi.spyOn(fixture.control.drizzle, "select").mockImplementationOnce(fields => {
              mutableAppPorts.controlDb = db;
              mutableAppInput.deploymentId = "changed-application-deployment";
              mutableAppInput.schemaVersionId = decodeCatalogSchemaVersionId("changed-application-version");
              return select(fields);
            })),
            () => prepareLogicalApplicationSourceAdmission(mutableAppPorts,
              fixture.application.uniqueConstraintEligibility, mutableAppInput, fixture.applicationSource),
            firstRead => Effect.sync(() => firstRead.mockRestore()));
          const located = yield* resolveLocatedTrustedScopeAuthorityEffect(fixture.deploymentId,
            fixture.application.authorityPorts);
          let lowered = false;
          const rolledBack = yield* Effect.exit(runEffectTransaction(work => db.transaction(work), "Payload logical source witness",
            (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
              const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, located.authority.scopeId);
              let defectToken: LogicalDocumentSourceAdmission | undefined;
              const defect = new Error("Payload callback defect");
              const defective = yield* Effect.exit(prepared.withAdmission(active.selection, tx, located.authority, clock,
                admission => Effect.sync(() => { defectToken = admission; }).pipe(Effect.andThen(Effect.die(defect)))));
              expect(Exit.isFailure(defective)).toBe(true);
              if (Exit.isFailure(defective)) expect(defective.cause.reasons.some(reason =>
                Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
              if (defectToken === undefined) throw new Error("Missing defect callback token");
              expect(yield* Effect.result(requireLogicalDocumentSourceAdmission(defectToken, tx)))
                .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
              const leaked = yield* prepared.withAdmission(active.selection, tx, located.authority, clock,
                admission => Effect.scoped(Effect.gen(function* () {
                  const selected = yield* requireLogicalDocumentSourceAdmission(admission, tx);
                  const escapedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(applicationCommandError,
                    cmsLimits, {}, {}, "application-escaped", "write"), value => value.close);
                  const closingLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(applicationCommandError,
                    cmsLimits, {}, {}, "application-closing", "write"), value => value.close);
                  const closedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(applicationCommandError,
                    cmsLimits, {}, {}, "application-closed", "write"), value => value.close);
                  const application = yield* appSource.withAdmission(active.selection, tx, located.authority, clock,
                    appAdmission => Effect.scoped(Effect.gen(function* () {
                      const appLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(applicationCommandError,
                        cmsLimits, {}, {}, "application-logical", "write"), value => value.close);
                      const appState = yield* requireLogicalApplicationSourceAdmission(appAdmission, tx);
                      expect(appState.head).toEqual(selected.head);
                      expect(appState.schemaVersionId).toBe(selected.schemaVersionId);
                      expect(appState.tables.map(table => table.localName)).toEqual(["users"]);
                      expect(yield* Effect.result(makeSourceApplicationInsertParticipant(appAdmission, tx,
                        appLifetime, "application-logical", "news"))).toMatchObject({ _tag: "Failure",
                          failure: { reason: "invalidAuthority" } });
                      const insert = yield* makeSourceApplicationInsertParticipant(appAdmission, tx,
                        appLifetime, "application-logical", "users");
                      const id = yield* insert.insert(appLifetime.context, { name: "Native Application" });
                      expect((yield* insert.readPending(appLifetime.context))._tag).toBe("Some");
                      yield* appLifetime.seal;
                      const changes = yield* insert.consume(yield* insert.close());
                      expect(changes).toHaveLength(1);
                      const escaped = yield* makeSourceApplicationInsertParticipant(appAdmission, tx,
                        escapedLifetime, "application-escaped", "users");
                      yield* escaped.insert(escapedLifetime.context, { name: "Escaped Application" });
                      const closing = yield* makeSourceApplicationInsertParticipant(appAdmission, tx,
                        closingLifetime, "application-closing", "users");
                      yield* closing.insert(closingLifetime.context, { name: "Closing Application" });
                      yield* closingLifetime.seal;
                      const closed = yield* makeSourceApplicationInsertParticipant(appAdmission, tx,
                        closedLifetime, "application-closed", "users");
                      yield* closed.insert(closedLifetime.context, { name: "Closed Application" });
                      yield* closedLifetime.seal;
                      const closure = yield* closed.close();
                      return { id, escaped, closing, closed, closure };
                    })));
                  expect(typeof application.id).toBe("string");
                  expect(yield* Effect.result(application.escaped.readPending(escapedLifetime.context)))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
                  expect(yield* Effect.result(application.closing.close()))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
                  expect(yield* Effect.result(application.closed.consume(application.closure)))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
                  expect(selected.schemaVersionId).toBe(input.schemaVersionId);
                  expect(selected.tables.map(table => table.localName)).toEqual(["news"]);
                  expect(selected.unique).toHaveLength(1);
                  expect(yield* Effect.result(requireLogicalDocumentSourceAdmission({ ...admission } as LogicalDocumentSourceAdmission, tx)))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
                  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(cmsError,
                    cmsLimits, {}, {}, "payload-logical", "write"),
                  current => current.close);
                  const working = yield* makeSourceCmsDocuments(admission, tx, lifetime, AppCreationTimeV1Schema.make(1));
                  const id = yield* lifetime.begin(lifetime.context);
                  const row = yield* working.documents.insert(lifetime.context, id, "news",
                    { title: "Payload-owned", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" });
                  expect((yield* working.documents.get(lifetime.context, id, String(row._id)))?.title).toBe("Payload-owned");
                  yield* lifetime.seal;
                  const closed = yield* consumeSourceCmsDocumentClosure(yield* working.close(), admission, tx, lifetime);
                  const contribution = yield* validateSourceCmsDocumentContribution(admission, tx, closed);
                  expect(contribution.changes).toEqual(closed.changes);
                  const delta = yield* prepareSourceCmsDocumentDelta(admission, tx, clock, closed, {});
                  expect(delta.changes).toEqual(closed.changes);
                  const change = closed.changes[0];
                  if (change?.kind !== "live") throw new Error("Missing Payload pending row");
                  expect(Result.isSuccess(selected.validate({ operation: "insert", tableName: "news", tableId: change.tableId,
                    documentId: change.documentId, creationTime: change.creationTime, document: change.document }))).toBe(true);
                  expect(selected.validate({ operation: "insert", tableName: "users", tableId: change.tableId,
                    documentId: change.documentId, creationTime: change.creationTime, document: change.document }))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
                  yield* delta.lower(CommitSeqSchema.make(clock.lastCommitSeq + 1n));
                  lowered = true;
                  const visible = yield* runDrizzleStatementEffect(tx.select().from(fxAppRowCurrent), cause =>
                    cmsError("statementFailure", cause));
                  expect(visible).toHaveLength(before.length + 1);
                  return admission;
                })));
              expect(yield* Effect.result(requireLogicalDocumentSourceAdmission(leaked, tx)))
                .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
              return yield* Effect.fail(new Error("Deliberate Payload lowering rollback"));
            })), cause => new Error("Payload logical source transaction", { cause })));
          expect(lowered).toBe(true);
          expect(Exit.isFailure(rolledBack)).toBe(true);
        })));
        expect(await db.select().from(fxAppRowCurrent)).toEqual(before);
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length) throw new AggregateError(failures, "Payload source witness cleanup failed");
      }
    }, 180_000);

    it.skipIf(driver === "postgres" && postgresUrl === null)(`publishes selected Payload through the CMS host on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        const compiled = await Effect.runPromise(compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]));
        const create = defineCmsCommand({ name: "createLogicalNews", mode: "write", run: (ctx, args) =>
          ctx.documents.insert(ctx.context, ctx.transactionId, "news", args) });
        const read = defineCmsCommand({ name: "readLogicalNews", mode: "read", run: (ctx, args) =>
          ctx.documents.get(ctx.context, ctx.transactionId, String(args)) });
        const db = fixture.persistence.drizzle;
        const before = await db.select().from(fxAppRowCurrent);
        const durableBefore = await logicalCurrencyInventory(fixture);
        let reachedMaterialization = false;
        const hostInput = { hostRuntime: preparedHostTestRuntime(db), database: db,
          controlDatabase: fixture.control.drizzle, session: fixture.session, deploymentId: fixture.deploymentId,
          authority: fixture.application.authorityPorts,
          application: fixture.application.activation, commands: [create, read], identityAndAccessPolicy: { profile: "logical-news" },
          materialization: { afterTransactionStep: async ({ step }: { readonly step: string }) => {
            if (step === "indexBatchWritten") { reachedMaterialization = true; throw new Error("Late CMS materialization fault"); }
          } }, expectedContentIdentity: compiled.contentIdentity,
          logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts },
            unique: fixture.application.uniqueConstraintEligibility, schemaVersionId: fixture.schemaVersionId,
            source: compiled.sourceContract } };
        const unavailable = await Effect.runPromise(makeCmsHost({ ...hostInput,
          application: { readActive: () => Effect.fail(new DataBindingError({ reason: "resourceFailure" })) } }));
        cleanup.push(() => Effect.runPromise(unavailable.close));
        expect(await Effect.runPromise(Effect.result(unavailable.run(unavailable.newRequestKey(), create, { title: "unavailable" }))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure" } });
        const failing = await Effect.runPromise(makeCmsHost(hostInput));
        cleanup.push(() => Effect.runPromise(failing.close));
        const key = failing.newRequestKey();
        const input = { title: "Source-owned news", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" };
        const failed = await Effect.runPromise(Effect.exit(failing.run(key, create, input)));
        expect(Exit.isFailure(failed)).toBe(true);
        expect(reachedMaterialization).toBe(true);
        expect(await logicalCurrencyInventory(fixture)).toEqual(durableBefore);
        const host = await Effect.runPromise(makeCmsHost({ ...hostInput, materialization: {} }));
        cleanup.push(() => Effect.runPromise(host.close));
        const created = await Effect.runPromise(host.run(key, create, input));
        expect(created).toMatchObject({ title: input.title });
        if (created === null || typeof created !== "object" || !("_id" in created) || typeof created._id !== "string")
          throw new Error("CMS host returned no document id");
        expect(await Effect.runPromise(host.read(read, created._id))).toMatchObject({ title: input.title });
        expect(await db.select().from(fxAppRowCurrent)).toHaveLength(before.length + 1);
        expect(await Effect.runPromise(host.run(key, create, input))).toEqual(created);
        expect(await db.select().from(fxAppRowCurrent)).toHaveLength(before.length + 1);
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length) throw new AggregateError(failures, "Source CMS host cleanup failed");
      }
    }, 180_000);

    it.skipIf(driver === "postgres" && postgresUrl === null)(`refuses Payload relationships without an edge owner on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const collections = [{ slug: "news", fields: [
          { name: "title", type: "text", required: true },
          { name: "related", type: "relationship", relationTo: "news" },
        ] }] as const;
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { payloadCollections: collections });
        const compiled = await Effect.runPromise(compilePayloadCollections(collections));
        const refusal = await Effect.runPromise(Effect.result(prepareLogicalDocumentSourceAdmission(
          { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts },
          fixture.application.uniqueConstraintEligibility,
          { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
            schemaVersionId: fixture.schemaVersionId }, compiled.sourceContract)));
        expect(refusal).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length) throw new AggregateError(failures, "Payload relationship refusal cleanup failed");
      }
    }, 180_000);

    it.skipIf(driver === "postgres" && postgresUrl === null)(`serves and publishes on ${driver} without Currency module tables`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        expect(await fixture.service.retrieveCurrency("USD")).toMatchObject({ code: "usd" });
        expect(await fixture.service.listAndCountCurrencies({ code: ["usd"] }, { take: 1 }))
          .toMatchObject([[{ code: "usd" }], 1]);
        const initial = await logicalCurrencyInventory(fixture);
        expect(initial.rows).toHaveLength(123);
        expect(initial.initialization)
          .toMatchObject([{ sourceKey: "medusa.currency", rowCount: 123 }]);
        expect(initial.physicalFacts).toEqual([]);
        const key = fixture.host.newRequestKey();
        const input = { code: "zzz", name: "Logical native Currency", symbol: "Z", symbol_native: "Z" };
        const created = await Effect.runPromise(fixture.host.run(key, currencyAnnouncementWrite, input));
        expect(created).toMatchObject({ code: "zzz", name: input.name });
        const published = await logicalCurrencyInventory(fixture);
        expect(published.rows).toHaveLength(124);
        expect(published.physicalFacts).toEqual([]);
        expect(published.outcomes).toHaveLength(initial.outcomes.length + 1);
        expect(await Effect.runPromise(fixture.host.run(key, currencyAnnouncementWrite, input))).toEqual(created);
        expect(await logicalCurrencyInventory(fixture)).toEqual(published);
        const swallowed = defineCommerceCommand("logicalCurrencyCaughtRefusal", "write", ctx =>
          ctx.nested(currencyAnnouncementWrite, { code: "yyy", name: "Must roll back", symbol: "Y", symbol_native: "Y" }).pipe(
            Effect.andThen(ctx.refuse(commerceError("invalidInput"))),
            Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
        const lifecycle = defineCommerceCommand("logicalCurrencyLifecycle", "write", (ctx, action) =>
          withCurrencyService(ctx, async ({ repository, context }) => {
            if (action === "softDelete") return repository.softDelete({ code: "zzz" }, context);
            if (action === "restore") return repository.restore({ code: "zzz" }, context);
            return repository.delete({ code: "zzz" }, context);
          }));
        const active = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput,
          commands: [...fixture.hostInput.commands, swallowed, lifecycle] }));
        cleanup.push(() => Effect.runPromise(active.close));
        const refused = await Effect.runPromise(Effect.exit(active.run(active.newRequestKey(), swallowed, null)));
        expect(Exit.isFailure(refused)).toBe(true);
        if (Exit.isFailure(refused)) expect(refused.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason))
          .toEqual(["rollbackOnly", "invalidInput"]);
        expect(await logicalCurrencyInventory(fixture)).toEqual(published);
        await Effect.runPromise(active.run(active.newRequestKey(), lifecycle, "softDelete"));
        await expect(fixture.service.retrieveCurrency("zzz")).rejects.toThrow("was not found");
        await Effect.runPromise(active.run(active.newRequestKey(), lifecycle, "restore"));
        expect(await fixture.service.retrieveCurrency("ZZZ")).toMatchObject({ name: input.name });
        expect(await Effect.runPromise(active.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        const beforeDelete = await logicalCurrencyInventory(fixture);
        await Effect.runPromise(active.run(active.newRequestKey(), lifecycle, "delete"));
        await expect(fixture.service.retrieveCurrency("zzz")).rejects.toThrow("was not found");
        const afterDelete = await logicalCurrencyInventory(fixture);
        expect(afterDelete.rows).toHaveLength(beforeDelete.rows.length);
        expect(afterDelete.revisions.filter(row => row.isTombstone))
          .toHaveLength(beforeDelete.revisions.filter(row => row.isTombstone).length + 1);
        expect(afterDelete.uniqueKeys.length).toBeLessThan(beforeDelete.uniqueKeys.length);
        expect(afterDelete.physicalFacts).toEqual([]);
        await Effect.runPromise(active.run(active.newRequestKey(), currencyAnnouncementWrite, input));
        expect(await fixture.service.retrieveCurrency("ZZZ")).toMatchObject({ name: input.name });
        const physical = await fixture.persistence.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = current_schema() and left(table_name, 5) = 'fxrt_'");
        expect(physical.rows).toEqual([]);
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length) throw new AggregateError(failures, "Logical Currency fixture cleanup failed");
      }
    }, 180_000);
  }
});
