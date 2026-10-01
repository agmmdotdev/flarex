import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { prepareLogicalApplicationSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/applicationAdmission";
import { prepareLogicalDocumentSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/documentAdmission";
import { prepareLogicalRelationalAdmission } from "../../persistence-postgres/src/logicalDocuments/relationalAdmission";
import { makeSourceApplicationInsertParticipant, applicationCommandError } from
  "../../persistence-postgres/src/applicationDocumentMaterialization/insertParticipant";
import { makeSourceCmsDocuments, consumeSourceCmsDocumentClosure } from "../../persistence-postgres/src/cmsTransaction/documents";
import { cmsError, cmsLimits } from "../../persistence-postgres/src/cmsTransaction/model";
import { makeLogicalCommerceParticipant, consumeLogicalCommerceClosure } from
  "../../persistence-postgres/src/commerceTransaction/logicalParticipant";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";
import { getCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { prepareJointLogicalMaterialization } from "../../persistence-postgres/src/crossDomainCommand/materialization";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../persistence-postgres/src/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../persistence-postgres/src/scopeClock";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { currencyAnnouncementWrite } from "../src/currency-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

describe("joint selected logical sources", () => {
  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(`lowers native Currency, Payload and Application in one rollback-bound delta on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        const db = fixture.persistence.drizzle;
        const before = await logicalCurrencyInventory(fixture);
        await Effect.runPromise(Effect.fn("JointLogicalSources.rollback")(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]);
        const ports = { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts };
        const input = { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
          schemaVersionId: fixture.schemaVersionId };
        const prepared = yield* Effect.all({
          application: prepareLogicalApplicationSourceAdmission(ports,
            fixture.application.uniqueConstraintEligibility, input, fixture.applicationSource, { kind: "standalone" }),
          payload: prepareLogicalDocumentSourceAdmission(ports,
            fixture.application.uniqueConstraintEligibility, input, compiled.sourceContract, { kind: "standalone" }),
          currency: prepareLogicalRelationalAdmission(ports,
            fixture.application.uniqueConstraintEligibility, input, fixture.hostInput.logicalStorage.source, { kind: "standalone" }),
        });
        const active = yield* fixture.application.activation.readActive();
        const located = yield* resolveLocatedTrustedScopeAuthorityEffect(fixture.deploymentId,
          fixture.application.authorityPorts);
        let lowered = false;
        const rolledBack = yield* Effect.exit(runEffectTransaction(work => db.transaction(work),
          "Joint logical source rollback", (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
            const snapshot = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
            return yield* prepared.application.withAdmission(active.selection, tx, located.authority, snapshot,
              application => prepared.payload.withAdmission(active.selection, tx, located.authority, snapshot,
                payload => prepared.currency.withAdmission(active.selection, tx, located.authority, snapshot,
                  currency => Effect.scoped(Effect.gen(function* () {
                    const appLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(applicationCommandError,
                      cmsLimits, {}, {}, "joint-application", "write"), value => value.close);
                    const cmsLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(cmsError,
                      cmsLimits, {}, {}, "joint-payload", "write"), value => value.close);
                    const commerceLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
                      cmsLimits, {}, {}, "joint-currency", "write"), value => value.close);
                    const app = yield* makeSourceApplicationInsertParticipant(application, tx, appLifetime,
                      "joint-application", "users");
                    const cms = yield* makeSourceCmsDocuments(payload, tx, cmsLifetime,
                      AppCreationTimeV1Schema.make(1));
                    const commerce = yield* makeLogicalCommerceParticipant(currency, tx, commerceLifetime,
                      commerceLifetime.context, "joint-currency");
                    const appId = yield* app.insert(appLifetime.context, { name: "Joint application" });
                    const payloadRow = yield* cms.documents.insert(cmsLifetime.context, "joint-payload", "news",
                      { title: "Joint payload", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" });
                    const native = getCommerceCommand(currencyAnnouncementWrite);
                    if (native === undefined) throw new Error("Missing native Currency command");
                    const currencyRow = yield* native.run(makeCommerceCommandContext(commerceLifetime, commerce,
                      "joint-currency", commerceLifetime.context,
                      () => Effect.fail(commerceError("invalidAuthority")),
                      () => Effect.fail(commerceError("unadmittedEvent"))),
                    { code: "zzz", name: "Joint currency", symbol: "Z", symbol_native: "Z" });
                    expect(currencyRow).toMatchObject({ code: "zzz" });
                    expect(payloadRow).toMatchObject({ title: "Joint payload" });
                    expect(typeof appId).toBe("string");
                    yield* appLifetime.seal;
                    yield* cmsLifetime.seal;
                    yield* commerceLifetime.seal;
                    const appChanges = yield* app.consume(yield* app.close());
                    const payloadChanges = yield* consumeSourceCmsDocumentClosure(yield* cms.close(), payload, tx, cmsLifetime);
                    const currencyChanges = (yield* consumeLogicalCommerceClosure(yield* commerce.close(), commerceLifetime)).changes;
                    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, located.authority.scopeId);
                    const jointInput = { tx, clock, application, payload, currency,
                      applicationChanges: appChanges, payloadChanges, currencyChanges, options: {} };
                    const delta = yield* prepareJointLogicalMaterialization(jointInput);
                    expect(delta.changes).toHaveLength(3);
                    yield* prepared.application.withAdmission(active.selection, tx, located.authority, snapshot,
                      replacement => Effect.sync(() => { jointInput.application = replacement; }));
                    yield* delta.lower(CommitSeqSchema.make(clock.lastCommitSeq + 1n));
                    lowered = true;
                    expect((yield* runDrizzleStatementEffect(tx.select().from(fxAppRowCurrent), cause =>
                      new Error("Joint row read", { cause }))).length)
                      .toBe(before.rows.length + 3);
                    return yield* Effect.fail(new Error("Deliberate joint lowering rollback"));
                  })))));
          })), cause => new Error("Joint logical transaction", { cause })));
        expect(lowered).toBe(true);
        expect(Exit.isFailure(rolledBack)).toBe(true);
        })());
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length > 0) throw new AggregateError(failures, "Joint logical fixture cleanup failed");
      }
    }, 180_000);
  }
});
