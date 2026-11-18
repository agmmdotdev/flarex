import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, gt } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runEffectTransaction, runEffectTransactionSettlement } from "../../database/effectTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { lockScopeClockForUpdateInTransactionEffect, requireScopeAuthorizationRevocationEpochInTransactionEffect } from "../../scope/scopeClock";
import { lockSchemaManifestBindingDeploymentEffect } from "../catalog/schemaManifestTableBindings";
import { fxSystemDataBindingHeads } from "../../installation/frameworkSchema/binding/schema";
import { readBindingSelectedEvidence } from "../../installation/frameworkSchema/binding/repository";
import { bindingError, type DataBindingError } from "../../installation/frameworkSchema/binding/errors";
import { readCoherentApplicationActiveHeadForShareInTransactionEffect,
  readApplicationSchemaForHeadForShareInTransactionEffect } from "../../application/applicationActiveHeadRead";
import { readBindingMaintenanceRequirements, replaceBindingMaintenanceInTransaction } from "./bindingMaintenance";
const migrationStatement = <Value>(query: PromiseLike<Value>) => runDrizzleStatementEffect(query,
  cause => bindingError("resourceFailure",cause));

/** Fixed populated conversion inside installation maintenance. The publisher
 * proves the genuine draining backend before opening against an existing head;
 * no new activation, business-data reset or retention frontier is fabricated. */
export const backfillBindingMaintenance = Effect.fn("BindingMaintenanceMigration.backfill")(
  function* (database: FlarexMetadataDatabase,controlDb: FlarexMetadataDatabase) {
    let cursor: string | undefined;
    for (;;) {
      const page = yield* migrationStatement(database.select({ scopeId: fxSystemDataBindingHeads.scopeId,
        storageGeneration: fxSystemDataBindingHeads.storageGeneration }).from(fxSystemDataBindingHeads)
        .where(and(eq(fxSystemDataBindingHeads.storageGeneration,"flarexdb_v1"),
          cursor === undefined ? undefined : gt(fxSystemDataBindingHeads.scopeId,cursor)))
        .orderBy(asc(fxSystemDataBindingHeads.scopeId)).limit(64));
      if (page.length===0) return;
      for (const location of page) {
        const hint = yield* runEffectTransactionSettlement<Effect.Success<ReturnType<typeof readBindingSelectedEvidence>>,DataBindingError,DataBindingError,FlarexMetadataTransaction>(work => database.transaction(work),"Binding conversion selector rolled back",
          tx => readBindingSelectedEvidence(tx,location),cause => bindingError("resourceFailure",cause));
        if (Option.isNone(hint)) return yield* Effect.fail(bindingError("storedCorruption"));
        const deploymentId = hint.value.candidate.frame.application.deploymentId;
        const convert = (tx: FlarexMetadataTransaction,catalog: FlarexMetadataTransaction) => Effect.gen(function* () {
          const scopeId = yield* Schema.decodeUnknownEffect(ScopeIdSchema)(location.scopeId)
            .pipe(Effect.mapError(cause => bindingError("storedCorruption",cause)));
          const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx,scopeId);
          const selected = yield* readBindingSelectedEvidence(tx,location);
          if (Option.isNone(selected) || selected.value.head.sha256!==hint.value.head.sha256)
            return yield* Effect.fail(bindingError("storedCorruption"));
          const { candidate,activation,head } = selected.value;
          if (candidate.frame.logicalSchema===null) return;
          const reference = candidate.frame.application;
          const active = yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(tx,scopeId);
          if (active===null) return yield* Effect.fail(bindingError("storedCorruption"));
          const schema = yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx,active.head);
          const epoch = yield* requireScopeAuthorizationRevocationEpochInTransactionEffect(tx,scopeId);
          const acceptedEpoch = activation.frame.version===3 ? activation.frame.authorizationRevocationEpoch : reference.authorizationRevocationEpoch;
          if (reference.deploymentId!==deploymentId || reference.scopeId!==clock.scopeId ||
            reference.storageGeneration!==clock.storageGeneration || reference.storageGenerationFence!==clock.storageGenerationFence.toString() ||
            reference.epoch!==clock.epoch || acceptedEpoch!==epoch.toString() ||
            reference.activationSequence!==active.head.activationSequence.toString() || reference.headSha256!==encodeBytesToLowercaseHex(active.head.headSha256) ||
            reference.activationSha256!==encodeBytesToLowercaseHex(active.head.activationSha256) || reference.revisionId!==active.head.revisionId ||
            reference.schemaVersionId!==schema.schemaVersionId || reference.schemaManifestSha256!==schema.schemaManifestSha256)
            return yield* Effect.fail(bindingError("storedCorruption"));
          const requirements = yield* readBindingMaintenanceRequirements(controlDb,deploymentId,candidate.frame.logicalSchema,catalog);
          yield* replaceBindingMaintenanceInTransaction(tx,{ scopeId,expectedHead: { sequence: head.frame.sequence,sha256: head.sha256 },
            sequence: head.frame.sequence,activationSha256: head.frame.activationSha256,headSha256: head.sha256,
            candidateSha256: head.frame.candidateSha256 },requirements,requirements);
        });
        const unit = (catalog?: FlarexMetadataTransaction) => Effect.uninterruptible(runEffectTransactionSettlement(
          work => database.transaction(work),"Binding maintenance conversion rolled back",tx => catalog===undefined
            ? lockSchemaManifestBindingDeploymentEffect(tx,deploymentId).pipe(Effect.andThen(() => convert(tx,tx)))
            : convert(tx,catalog),cause => bindingError("resourceFailure",cause)));
        if (controlDb===database) yield* unit();
        else yield* runEffectTransaction(work => controlDb.transaction(work),"Binding conversion catalog rolled back",
          catalog => lockSchemaManifestBindingDeploymentEffect(catalog,deploymentId).pipe(Effect.andThen(() => unit(catalog))),
          cause => bindingError("resourceFailure",cause));
        cursor=location.scopeId;
      }
    }
  },
);
