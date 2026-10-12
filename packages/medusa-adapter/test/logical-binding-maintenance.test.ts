import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { and, asc, desc, eq, getTableName, inArray } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CommitSeqSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds,
  fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations,
  fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxAppRowCurrent, fxAppRowRevisions } from "../../persistence-postgres/src/database/schema";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { bindingError } from "../../persistence-postgres/src/installation/frameworkSchema/binding/errors";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { currencyAnnouncementWrite, currencyCommands } from "../src/currency-service";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./support/logical-currency-fixture";
import { appendPreparedAppRowRevisionsInTransactionEffect } from "../../persistence-postgres/src/storage/documents/appRows";
import { lockInstallationForCurrentTransaction } from "../../persistence-postgres/src/installation/installationLifecycle";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import { restoreMaintenanceAuthorityPredecessor } from "../../persistence-postgres/test/installation/maintenanceAuthorityMigrationSupport";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { fxSystemDataBindingHeads, fxSystemDataBindingActivations } from "../../persistence-postgres/src/installation/frameworkSchema/binding/schema";
import { fxSystemApplicationActiveHeads, fxSystemApplicationActivations } from "../../persistence-postgres/src/application/applicationActivationSchema";
import { APP_PUBLICATION_APPLICATION_FUNCTION } from "../../persistence-postgres/src/storage/materialization/publicationStagesInstallation";
import type { FlarexMetadataDatabase } from "../../persistence-postgres/src/application/deployments";
import { getTableConfig, type PgTransactionConfig } from "drizzle-orm/pg-core";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { NodePgSession } from "drizzle-orm/node-postgres/session";
const quote = (name: string) => `"${name.replaceAll('"','""')}"`;

/** Remove only one complete-publication requirement. All genuine scalar and
 * materialization parameters remain the native host's prepared evidence. */
function omitPublicationRequirement(text: string, argument: "p_build_ids" | "p_unique_ids", definitionId: number): string {
  const marker = ".fx_apply_app_publication(";
  const start = text.indexOf(marker);
  if (start<0) return text;
  const position = APP_PUBLICATION_APPLICATION_FUNCTION.inputs.indexOf(argument);
  if (position<0) throw new Error("Missing native requirement argument");
  let ordinal=0,depth=0,quote: string | undefined;
  let argumentStart=start+marker.length;
  for (let offset=argumentStart;offset<text.length;offset++) {
    const character=text[offset];
    if (quote!==undefined) {
      if (character===quote) { if (text[offset+1]===quote) offset++; else quote=undefined; }
      continue;
    }
    if (character==="'" || character==='"') { quote=character;continue; }
    if (character==="(" || character==="[") { depth++;continue; }
    if (character===")" || character==="]") {
      if (depth>0) { depth--;continue; }
    } else if (character!=="," || depth!==0) continue;
    if (ordinal===position) return `${text.slice(0,argumentStart)}pg_catalog.array_remove(${text.slice(argumentStart,offset)},${definitionId}::integer)${text.slice(offset)}`;
    ordinal++;argumentStart=offset+1;
  }
  throw new Error("Incomplete native publication invocation");
}

async function maintenanceInventory(fixture: LogicalCurrencyFixture) {
  const database = fixture.testOwner.drizzle;
  const scopeId = fixture.application.authority.scopeId;
  return {
    indexes: await database.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId,scopeId))
      .orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)),
    unique: await database.select().from(fxSystemUniqueConstraintBuilds).where(eq(fxSystemUniqueConstraintBuilds.scopeId,scopeId))
      .orderBy(asc(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId)),
    indexOpenings: await database.select().from(fxSystemIndexMaintenanceObligations).where(eq(fxSystemIndexMaintenanceObligations.scopeId,scopeId))
      .orderBy(asc(fxSystemIndexMaintenanceObligations.authorityKind),asc(fxSystemIndexMaintenanceObligations.activationSequence),asc(fxSystemIndexMaintenanceObligations.indexDefinitionId)),
    uniqueOpenings: await database.select().from(fxSystemUniqueMaintenanceObligations).where(eq(fxSystemUniqueMaintenanceObligations.scopeId,scopeId))
      .orderBy(asc(fxSystemUniqueMaintenanceObligations.authorityKind),asc(fxSystemUniqueMaintenanceObligations.activationSequence),asc(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)),
  };
}

describe("framework binding maintenance lifecycle", () => {
  for (const driver of ["pglite","postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(`retains coverage through writes, rolls back, carries and seals on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver,close => cleanup.push(close),
          { protectedRuntime: driver === "postgres" });
        const bindingBase = { database: fixture.persistence.drizzle,
          selection: { deploymentId: fixture.deploymentId,scopeId: fixture.application.authority.scopeId },
          target: fixture.bindingTarget,authority: fixture.application.authorityPorts,application: fixture.application.activation };
        const bindingInput = { ...bindingBase,logicalStorage: { controlDb: fixture.control.drizzle,
          schemaVersionId: fixture.schemaVersionId,unique: fixture.application.uniqueConstraintEligibility } };
        const configured = await Effect.runPromise(makeDataBindingHost(bindingInput));
        const initial = await Effect.runPromise(configured.withCurrent(readAdmittedDataBinding));
        const opened = await maintenanceInventory(fixture);
        expect(opened.indexes.filter(build => build.maintenanceAuthorityKind === "binding").length).toBeGreaterThan(0);
        expect(opened.unique.filter(build => build.maintenanceAuthorityKind === "binding").length).toBeGreaterThan(0);
        expect(opened.indexOpenings.some(opening => opening.authorityKind === "application" && opening.activationSequence === 1n)).toBe(true);
        expect(opened.indexOpenings.some(opening => opening.authorityKind === "binding" && opening.activationSequence === 1n)).toBe(true);
        const appIndexes = opened.indexes.filter(build => build.maintenanceAuthorityKind === "application");
        const appUnique = opened.unique.filter(build => build.maintenanceAuthorityKind === "application");
        const clockBefore = await fixture.testOwner.drizzle.select().from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId,fixture.application.authority.scopeId));
        // Both writes retain Currency's indexed and unique code, while changing
        // its value. Each complete commit advances the scope, not build rows.
        for (const ordinal of [1,2]) await Effect.runPromise(fixture.host.run(`commerce/${driver}-stable-maintenance-${ordinal}`,
          currencyAnnouncementWrite,{ code: "usd",name: `Dollar ${ordinal}`,symbol: "$",symbol_native: "$" }));
        const clockAfter = await fixture.testOwner.drizzle.select().from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId,fixture.application.authority.scopeId));
        expect(clockAfter[0]!.lastCommitSeq).toBe(clockBefore[0]!.lastCommitSeq + 2n);
        expect(await maintenanceInventory(fixture)).toEqual(opened);
        expect(await Effect.runPromise(fixture.host.read(currencyCommands.retrieve,
          { code: "usd",config: { select: ["code","name"] } }))).toMatchObject({ code: "usd",name: "Dollar 2" });

        const frameworkTables = opened.indexOpenings.filter(opening => opening.authorityKind === "binding").map(opening => opening.tableId);
        const [revision] = await fixture.testOwner.drizzle.select().from(fxAppRowRevisions)
          .where(inArray(fxAppRowRevisions.tableId,frameworkTables)).orderBy(desc(fxAppRowRevisions.commitSeq)).limit(1);
        expect(revision).toBeDefined();
        const frameworkOpening = opened.indexOpenings.find(opening => opening.authorityKind === "binding" && opening.tableId===revision!.tableId)!;
        const rowId = await Effect.runPromise(Effect.fromResult(appRowIdHexV1FromBytesResult(revision!.rowId)));
        const attemptLowMutation = () => Effect.runPromise(runEffectTransaction(work => fixture.testOwner.drizzle.transaction(work),
          "Low row mutation refused",tx => Effect.gen(function* () {
            yield* lockInstallationForCurrentTransaction(tx);
            yield* appendPreparedAppRowRevisionsInTransactionEffect(tx,[{ kind: "tombstone",
              scopeId: fixture.application.authority.scopeId,tableId: frameworkOpening.tableId,rowId,
              writeEpoch: fixture.application.authority.epoch,commitSeq: CommitSeqSchema.make(clockAfter[0]!.lastCommitSeq+1n),
              prevCommitSeq: revision!.commitSeq,schemaVersionId: revision!.schemaVersionId,creationTime: revision!.creationTime }]);
          }),cause => new Error("Low row transaction failed",{ cause })));
        await expect(attemptLowMutation())
          .rejects.toMatchObject({ reason: "bindingMaintenanceRequired" });
        expect(await maintenanceInventory(fixture)).toEqual(opened);
        const tableIndexes = opened.indexes.filter(build => opened.indexOpenings.some(opening => opening.authorityKind === "binding" &&
          opening.tableId===frameworkOpening.tableId && opening.indexDefinitionId===build.indexDefinitionId));
        const tableUnique = opened.unique.filter(build => opened.uniqueOpenings.some(opening => opening.authorityKind === "binding" &&
          opening.tableId===frameworkOpening.tableId && opening.uniqueConstraintDefinitionId===build.uniqueConstraintDefinitionId));
        await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set({ maintenanceAuthorityKind: null,
          maintenanceActivationSequence: null,coveredThroughCommitSeq: clockAfter[0]!.lastCommitSeq })
          .where(and(eq(fxSystemIndexBuildStates.scopeId,frameworkOpening.scopeId),
            inArray(fxSystemIndexBuildStates.indexDefinitionId,tableIndexes.map(build => build.indexDefinitionId))));
        await fixture.testOwner.drizzle.update(fxSystemUniqueConstraintBuilds).set({ maintenanceAuthorityKind: null,
          maintenanceActivationSequence: null,coveredThroughCommitSeq: clockAfter[0]!.lastCommitSeq })
          .where(and(eq(fxSystemUniqueConstraintBuilds.scopeId,frameworkOpening.scopeId),
            inArray(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,tableUnique.map(build => build.uniqueConstraintDefinitionId))));
        const rowsBeforeUnmaintainedAttempt = await fixture.testOwner.drizzle.select().from(fxAppRowCurrent);
        const revisionsBeforeUnmaintainedAttempt = await fixture.testOwner.drizzle.select().from(fxAppRowRevisions);
        try {
          await expect(attemptLowMutation()).rejects.toMatchObject({ reason: "bindingMaintenanceRequired" });
          expect(await fixture.testOwner.drizzle.select().from(fxAppRowCurrent)).toEqual(rowsBeforeUnmaintainedAttempt);
          expect(await fixture.testOwner.drizzle.select().from(fxAppRowRevisions)).toEqual(revisionsBeforeUnmaintainedAttempt);
        } finally {
          for (const build of tableIndexes) await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set(build)
            .where(and(eq(fxSystemIndexBuildStates.scopeId,build.scopeId),eq(fxSystemIndexBuildStates.indexDefinitionId,build.indexDefinitionId)));
          for (const build of tableUnique) await fixture.testOwner.drizzle.update(fxSystemUniqueConstraintBuilds).set(build)
            .where(and(eq(fxSystemUniqueConstraintBuilds.scopeId,build.scopeId),eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,build.uniqueConstraintDefinitionId)));
        }
        expect(await maintenanceInventory(fixture)).toEqual(opened);
        if (driver === "postgres") {
          const privileges = await fixture.persistence.query<{ allowed: boolean }>(`select pg_catalog.has_function_privilege(session_user,
            pg_catalog.format('%I.fx_replace_binding_index_maintenance(text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb)',current_schema()),'EXECUTE') as allowed`);
          expect(privileges.rows).toEqual([{ allowed: false }]);
          await expect(fixture.persistence.query(`select * from fx_replace_binding_index_maintenance(
            null::text,null::bigint,null::text,null::bigint,null::text,null::text,null::text,null::text,null::text,null::text,null::jsonb,null::text,null::text,null::text,null::jsonb)`))
            .rejects.toMatchObject({ code: "42501" });
        }

        const beforeOmission = await logicalCurrencyInventory(fixture);
        const publicationDatabase: FlarexMetadataDatabase = fixture.persistence.drizzle;
        const originalTransaction = publicationDatabase.transaction.bind(publicationDatabase);
        for (const domain of ["index","unique"] as const) {
          const required = domain === "index" ? frameworkOpening.indexDefinitionId
            : opened.uniqueOpenings.find(opening => opening.authorityKind === "binding" && opening.tableId===frameworkOpening.tableId)!.uniqueConstraintDefinitionId;
          let intercepted=0;
          const originalPostgresPrepare = NodePgSession.prototype.prepareQuery;
          const postgresPreparation = driver !== "postgres" ? undefined : vi.spyOn(NodePgSession.prototype,"prepareQuery")
            .mockImplementation(function (this: typeof NodePgSession.prototype,query,...parameters) {
              const text=omitPublicationRequirement(query.sql,domain === "index" ? "p_build_ids" : "p_unique_ids",required);
              if (text!==query.sql) intercepted++;
              return originalPostgresPrepare.call(this,{ ...query,sql: text },...parameters);
            });
          const transaction = driver === "postgres" ? undefined : vi.spyOn(publicationDatabase,"transaction").mockImplementation(<Value>(work: (tx: Parameters<Parameters<typeof publicationDatabase.transaction>[0]>[0]) => Promise<Value>,configuration?: PgTransactionConfig) =>
            originalTransaction(async tx => {
              const originalPrepare = tx._.session.prepareQuery.bind(tx._.session);
              const preparation = vi.spyOn(tx._.session,"prepareQuery").mockImplementation((query,...parameters) => {
                const text=omitPublicationRequirement(query.sql,domain === "index" ? "p_build_ids" : "p_unique_ids",required);
                if (text!==query.sql) intercepted++;
                return originalPrepare({ ...query,sql: text },...parameters);
              });
              try { return await work(tx); } finally { preparation.mockRestore(); }
            },configuration));
          try {
            await expect(Effect.runPromise(fixture.host.run(`commerce/${driver}-omit-${domain}-maintenance`,currencyAnnouncementWrite,
              { code: "usd",name: "Must roll back",symbol: "$",symbol_native: "$" })))
              .rejects.toMatchObject({ reason: "storedCorruption" });
            expect(intercepted).toBe(1);
          } finally { transaction?.mockRestore();postgresPreparation?.mockRestore(); }
          const afterOmission=await logicalCurrencyInventory(fixture);
          expect(afterOmission.rows).toEqual(beforeOmission.rows);
          expect(afterOmission.revisions).toEqual(beforeOmission.revisions);
          expect(afterOmission.indexEntries).toEqual(beforeOmission.indexEntries);
          expect(afterOmission.uniqueKeys).toEqual(beforeOmission.uniqueKeys);
          expect(afterOmission.commits).toEqual(beforeOmission.commits);
          expect(afterOmission.clocks).toEqual(beforeOmission.clocks);
        }

        const rejecting = await Effect.runPromise(makeDataBindingHost({ ...bindingInput,
          testOnly: { afterAcceptance: () => Effect.fail(bindingError("resourceFailure")) } }));
        const candidate = await Effect.runPromise(configured.prepare(initial.frame));
        const physicalAuthority=(await fixture.testOwner.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId,fixture.application.authority.scopeId)))[0]!;
        await fixture.testOwner.drizzle.update(fxSystemScopeExecutionAuthorities).set({
          storageGenerationFence: StorageGenerationFenceSchema.make(physicalAuthority.storageGenerationFence+1n),
        }).where(eq(fxSystemScopeExecutionAuthorities.scopeId,physicalAuthority.scopeId));
        try {
          await expect(Effect.runPromise(configured.activate(dataBindingActivationRequest(initial.frame.application.scopeId,
            initial.frame.application.storageGeneration,`${driver}-stale-maintenance`,candidate.sha256,initial.head))))
            .rejects.toMatchObject({ _tag: "ApplicationReadinessError",reason: "authorityChanged" });
          expect(await maintenanceInventory(fixture)).toEqual(opened);
        } finally {
          await fixture.testOwner.drizzle.update(fxSystemScopeExecutionAuthorities).set({
            storageGenerationFence: physicalAuthority.storageGenerationFence,updatedAt: physicalAuthority.updatedAt,
          })
            .where(eq(fxSystemScopeExecutionAuthorities.scopeId,physicalAuthority.scopeId));
        }
        await expect(Effect.runPromise(rejecting.activate(dataBindingActivationRequest(initial.frame.application.scopeId,
          initial.frame.application.storageGeneration,`${driver}-rollback-maintenance`,candidate.sha256,initial.head))))
          .rejects.toMatchObject({ reason: "resourceFailure" });
        expect((await Effect.runPromise(configured.withCurrent(readAdmittedDataBinding))).head).toEqual(initial.head);
        expect(await maintenanceInventory(fixture)).toEqual(opened);

        await Effect.runPromise(configured.activate(dataBindingActivationRequest(initial.frame.application.scopeId,
          initial.frame.application.storageGeneration,`${driver}-carry-maintenance`,candidate.sha256,initial.head)));
        const carried = await Effect.runPromise(configured.withCurrent(readAdmittedDataBinding));
        const carriedInventory = await maintenanceInventory(fixture);
        expect(carriedInventory.indexes.filter(build => build.maintenanceAuthorityKind === "application")).toEqual(appIndexes);
        expect(carriedInventory.unique.filter(build => build.maintenanceAuthorityKind === "application")).toEqual(appUnique);
        for (const build of [...carriedInventory.indexes,...carriedInventory.unique].filter(build => build.maintenanceAuthorityKind === "binding")) {
          expect(build.maintenanceActivationSequence).toBe(BigInt(carried.head.sequence));
          expect(build.coveredThroughCommitSeq).toBe(clockAfter[0]!.lastCommitSeq);
        }
        const currentHost = await Effect.runPromise(makeCommerceHost(fixture.hostInput));
        cleanup.push(() => Effect.runPromise(currentHost.close));
        expect(await Effect.runPromise(currentHost.read(currencyCommands.retrieve,{ code: "usd" }))).toMatchObject({ name: "Dollar 2" });
        // Clearing both protected markers still cannot reinterpret a selected
        // framework requirement as ordinary bounded coverage at this clock.
        const guardedBuild = carriedInventory.indexes.find(build => build.indexDefinitionId===frameworkOpening.indexDefinitionId)!;
        await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set({ maintenanceAuthorityKind: null,
          maintenanceActivationSequence: null }).where(and(eq(fxSystemIndexBuildStates.scopeId,guardedBuild.scopeId),
            eq(fxSystemIndexBuildStates.indexDefinitionId,guardedBuild.indexDefinitionId)));
        try {
          await expect(Effect.runPromise(currentHost.read(currencyCommands.retrieve,{ code: "usd" })))
            .rejects.toMatchObject({ reason: "invalidAuthority" });
        } finally {
          await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set(guardedBuild)
            .where(and(eq(fxSystemIndexBuildStates.scopeId,guardedBuild.scopeId),
              eq(fxSystemIndexBuildStates.indexDefinitionId,guardedBuild.indexDefinitionId)));
        }
        expect(await maintenanceInventory(fixture)).toEqual(carriedInventory);
        const openingKey = getTableConfig(fxSystemIndexBuildStates).foreignKeys
          .find(key => key.getName().endsWith("maintenance_opening_fk"))!;
        const reference = openingKey.reference();
        const buildTable = quote(getTableName(fxSystemIndexBuildStates));
        const openingTable = quote(getTableName(fxSystemIndexMaintenanceObligations));
        const removedOpening = carriedInventory.indexOpenings.find(opening => opening.authorityKind === "binding" &&
          opening.indexDefinitionId===guardedBuild.indexDefinitionId && opening.activationSequence===guardedBuild.maintenanceActivationSequence)!;
        // Deliberate owner corruption removes only the current immutable witness;
        // protected build markers continue to point to it during the fresh read.
        await fixture.testOwner.query(`alter table ${buildTable} drop constraint ${quote(openingKey.getName())}`);
        await fixture.testOwner.query(`alter table ${openingTable} disable trigger fx_maintenance_immutable`);
        try {
          await fixture.testOwner.drizzle.delete(fxSystemIndexMaintenanceObligations).where(and(
            eq(fxSystemIndexMaintenanceObligations.scopeId,removedOpening.scopeId),
            eq(fxSystemIndexMaintenanceObligations.authorityKind,"binding"),
            eq(fxSystemIndexMaintenanceObligations.indexDefinitionId,removedOpening.indexDefinitionId),
            eq(fxSystemIndexMaintenanceObligations.activationSequence,removedOpening.activationSequence)));
          await expect(Effect.runPromise(currentHost.read(currencyCommands.retrieve,{ code: "usd" })))
            .rejects.toMatchObject({ reason: "invalidAuthority" });
        } finally {
          await fixture.testOwner.drizzle.insert(fxSystemIndexMaintenanceObligations).values(removedOpening);
          await fixture.testOwner.query(`alter table ${openingTable} enable trigger fx_maintenance_immutable`);
          await fixture.testOwner.query(`alter table ${buildTable} add constraint ${quote(openingKey.getName())} foreign key
            (${reference.columns.map(column => quote(column.name)).join(",")}) references ${openingTable}
            (${reference.foreignColumns.map(column => quote(column.name)).join(",")}) on update restrict on delete restrict`);
        }
        expect(await maintenanceInventory(fixture)).toEqual(carriedInventory);
        const unconfigured = await Effect.runPromise(makeDataBindingHost(bindingBase));
        const removedCandidate = await Effect.runPromise(unconfigured.prepare({ ...initial.frame,logicalSchema: null }));
        await Effect.runPromise(unconfigured.activate(dataBindingActivationRequest(initial.frame.application.scopeId,
          initial.frame.application.storageGeneration,`${driver}-seal-maintenance`,removedCandidate.sha256,carried.head)));
        const sealed = await maintenanceInventory(fixture);
        expect(sealed.indexOpenings).toEqual(carriedInventory.indexOpenings);
        expect(sealed.uniqueOpenings).toEqual(carriedInventory.uniqueOpenings);
        for (const before of carriedInventory.indexes.filter(build => build.maintenanceAuthorityKind === "binding")) {
          const after = sealed.indexes.find(build => build.indexDefinitionId===before.indexDefinitionId)!;
          expect(after.maintenanceAuthorityKind).toBeNull(); expect(after.maintenanceActivationSequence).toBeNull();
          expect(after.coveredThroughCommitSeq).toBe(clockAfter[0]!.lastCommitSeq);
        }
        for (const before of carriedInventory.unique.filter(build => build.maintenanceAuthorityKind === "binding")) {
          const after = sealed.unique.find(build => build.uniqueConstraintDefinitionId===before.uniqueConstraintDefinitionId)!;
          expect(after.maintenanceAuthorityKind).toBeNull(); expect(after.maintenanceActivationSequence).toBeNull();
          expect(after.coveredThroughCommitSeq).toBe(clockAfter[0]!.lastCommitSeq);
        }
        expect(await fixture.testOwner.drizzle.select().from(fxAppRowCurrent)).not.toEqual([]);
        expect(await fixture.testOwner.drizzle.select().from(fxAppRowRevisions)).not.toEqual([]);
        const removedRead=await Effect.runPromise(Effect.result(currentHost.read(currencyCommands.retrieve,{ code: "usd" })));
        expect(removedRead)
          .toMatchObject({ _tag: "Failure",failure: driver === "pglite" ? { reason: "bindingChanged" }
            : { reason: "resourceFailure",cause: { _tag: "ApplicationReadinessError",reason: "resourceFailure",
              cause: { _tag: "PreparedMetadataEpochError",reason: "changed" } } } });
      } finally { for (const close of cleanup.reverse()) await close(); }
    },180_000);

    it.skipIf(driver === "postgres" && postgresUrl === null)(`converts populated predecessor maintenance without changing durable data on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver,close => cleanup.push(close));
        await Effect.runPromise(fixture.host.run(`commerce/${driver}-populated-maintenance`,currencyAnnouncementWrite,
          { code: "usd",name: "Retained Dollar",symbol: "$",symbol_native: "$" }));
        const before = await maintenanceInventory(fixture);
        const durableBefore = await logicalCurrencyInventory(fixture);
        const database = fixture.testOwner.drizzle;
        const pinsBefore = {
          appHeads: await database.select().from(fxSystemApplicationActiveHeads),
          appActivations: await database.select().from(fxSystemApplicationActivations),
          bindingHeads: await database.select().from(fxSystemDataBindingHeads),
          bindingActivations: await database.select().from(fxSystemDataBindingActivations),
        };
        await restoreMaintenanceAuthorityPredecessor(fixture.testOwner,
          fixture.resource.kind === "postgres" ? fixture.resource.migrationJournalSchema : "drizzle");
        await fixture.testOwner.migrate();
        const converted = await maintenanceInventory(fixture);
        const durableAfter = await logicalCurrencyInventory(fixture);
        const { indexBuilds: beforeIndexes,uniqueBuilds: beforeUnique,...businessBefore } = durableBefore;
        const { indexBuilds: afterIndexes,uniqueBuilds: afterUnique,...businessAfter } = durableAfter;
        expect(beforeIndexes.length).toBe(afterIndexes.length); expect(beforeUnique.length).toBe(afterUnique.length);
        expect(businessAfter).toEqual(businessBefore);
        expect({
          appHeads: await database.select().from(fxSystemApplicationActiveHeads),
          appActivations: await database.select().from(fxSystemApplicationActivations),
          bindingHeads: await database.select().from(fxSystemDataBindingHeads),
          bindingActivations: await database.select().from(fxSystemDataBindingActivations),
        }).toEqual(pinsBefore);
        expect(converted.indexOpenings.filter(opening => opening.authorityKind === "application"))
          .toEqual(before.indexOpenings.filter(opening => opening.authorityKind === "application"));
        expect(converted.uniqueOpenings.filter(opening => opening.authorityKind === "application"))
          .toEqual(before.uniqueOpenings.filter(opening => opening.authorityKind === "application"));
        for (const opening of [...converted.indexOpenings,...converted.uniqueOpenings].filter(opening => opening.authorityKind === "binding")) {
          const head = pinsBefore.bindingHeads.find(value => value.scopeId===opening.scopeId)!;
          expect(opening.activationSequence).toBe(head.sequence);
          expect(encodeBytesToLowercaseHex(opening.headSha256)).toBe(head.sha256);
          expect(encodeBytesToLowercaseHex(opening.candidateSha256!)).toBe(head.candidateSha256);
        }
        expect(converted.indexOpenings.some(opening => opening.authorityKind === "binding")).toBe(true);
        expect(converted.uniqueOpenings.some(opening => opening.authorityKind === "binding")).toBe(true);
        await fixture.testOwner.migrate();
        expect(await maintenanceInventory(fixture)).toEqual(converted);
      } finally { for (const close of cleanup.reverse()) await close(); }
    },180_000);
  }
});
