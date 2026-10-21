import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { prepareLogicalApplicationSourceAdmission } from "../../persistence-postgres/src/storage/documents/logicalDocuments/applicationAdmission";
import { prepareLogicalDocumentSourceAdmission } from "../../persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission";
import { prepareLogicalRelationalAdmission } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission";
import { makeSourceApplicationInsertParticipant, ApplicationCommandError, applicationCommandError } from
  "../../persistence-postgres/src/storage/materialization/insertParticipant";
import { makeSourceCmsDocuments, consumeSourceCmsDocumentClosure } from "../../persistence-postgres/src/frameworks/cmsTransaction/documents";
import { CmsTransactionError, cmsError, cmsLimits } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { makeLogicalCommerceParticipant, consumeLogicalCommerceClosure } from
  "../../persistence-postgres/src/frameworks/commerceTransaction/logicalParticipant";
import { CommerceTransactionError, commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { getCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { prepareJointLogicalMaterialization } from "../../persistence-postgres/src/frameworks/crossDomainCommand/materialization";
import { compositeError, type CompositeFailure } from "../../persistence-postgres/src/frameworks/crossDomainCommand/model";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { currencyAnnouncementWrite } from "../src/modules/currency/service";
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
        const deliberateRollback = new Error("Deliberate joint lowering rollback");
        const rolledBack = yield* Effect.exit(runEffectTransaction(work => db.transaction(work),
          "Joint logical source rollback", (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
            const snapshot = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
            return yield* prepared.application.withAdmission(active.selection, tx, located.authority, snapshot,
              application => prepared.payload.withAdmission(active.selection, tx, located.authority, snapshot,
                payload => prepared.currency.withAdmission(active.selection, tx, located.authority, snapshot,
                  currency => Effect.scoped(Effect.gen(function* () {
                    const transactionId = "joint-logical";
                    const rootLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(
                      (reason, cause): CompositeFailure => compositeError(reason, cause), cmsLimits, {}, {}, transactionId, "write"), value => value.close);
                    const appLifetime = projectBoundedRequestLifetime(rootLifetime, error => error instanceof ApplicationCommandError
                      ? error : applicationCommandError("rollbackOnly", error));
                    const cmsLifetime = projectBoundedRequestLifetime(rootLifetime, error => error instanceof CmsTransactionError
                      ? error : cmsError("rollbackOnly", error));
                    const commerceLifetime = projectBoundedRequestLifetime(rootLifetime, error => error instanceof CommerceTransactionError
                      ? error : commerceError("rollbackOnly", error));
                    const app = yield* makeSourceApplicationInsertParticipant(application, tx, appLifetime,
                      transactionId, "users");
                    const cms = yield* makeSourceCmsDocuments(payload, tx, cmsLifetime,
                      AppCreationTimeV1Schema.make(1));
                    const commerce = yield* makeLogicalCommerceParticipant(currency, tx, commerceLifetime,
                      commerceLifetime.context, transactionId);
                    const appId = yield* app.insert(appLifetime.context, { name: "Joint application" });
                    const payloadRow = yield* cms.documents.insert(cmsLifetime.context, transactionId, "news",
                      { title: "Joint payload", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z" });
                    const native = getCommerceCommand(currencyAnnouncementWrite);
                    if (native === undefined) throw new Error("Missing native Currency command");
                    const currencyRow = yield* native.run(makeCommerceCommandContext(commerceLifetime, commerce,
                      transactionId, commerceLifetime.context,
                      () => Effect.fail(commerceError("invalidAuthority")),
                      () => Effect.fail(commerceError("unadmittedEvent"))),
                    { code: "zzz", name: "Joint currency", symbol: "Z", symbol_native: "Z" });
                    expect(currencyRow).toMatchObject({ code: "zzz" });
                    expect(payloadRow).toMatchObject({ title: "Joint payload" });
                    expect(typeof appId).toBe("string");
                    yield* rootLifetime.seal;
                    const appChanges = yield* app.consume(yield* app.close());
                    const { changes: payloadChanges, preferenceIntents } = yield* consumeSourceCmsDocumentClosure(yield* cms.close(), payload, tx, cmsLifetime);
                    expect(preferenceIntents).toEqual([]);
                    const currencyChanges = (yield* consumeLogicalCommerceClosure(yield* commerce.close(), commerceLifetime)).changes;
                    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, located.authority.scopeId);
                    const jointInput = { tx, clock, application, payload, currency,
                      applicationChanges: appChanges, payloadChanges, currencyChanges, options: {} };
                    const delta = yield* prepareJointLogicalMaterialization(jointInput);
                    expect(delta.changes).toHaveLength(3);
                    expect(delta.changes.flatMap(row => row.insertionOrder?.kind === "pending" ? [row.insertionOrder.attemptOrdinal] : [])
                      .toSorted((left, right) => left - right)).toEqual([0, 1]);
                    yield* prepared.application.withAdmission(active.selection, tx, located.authority, snapshot,
                      replacement => Effect.sync(() => { jointInput.application = replacement; }));
                    yield* delta.lower(CommitSeqSchema.make(clock.lastCommitSeq + 1n));
                    expect((yield* runDrizzleStatementEffect(tx.select().from(fxAppRowCurrent), cause =>
                      new Error("Joint row read", { cause }))).length)
                      .toBe(before.rows.length + 3);
                    lowered = true;
                    return yield* Effect.fail(deliberateRollback);
                  })))));
          })), cause => new Error("Joint logical transaction", { cause })));
        expect(lowered, Exit.isFailure(rolledBack) ? Cause.pretty(rolledBack.cause) : "Unexpected successful settlement").toBe(true);
        expect(Exit.isFailure(rolledBack)).toBe(true);
        if (Exit.isFailure(rolledBack)) {
          expect(rolledBack.cause.reasons).toHaveLength(1);
          expect(rolledBack.cause.reasons.find(Cause.isFailReason)?.error).toBe(deliberateRollback);
        }
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
