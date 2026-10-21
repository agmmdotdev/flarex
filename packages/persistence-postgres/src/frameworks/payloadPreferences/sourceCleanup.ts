import { Effect, Option, Result } from "effect";
import { AppDocumentIdV1Schema, decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result } from "flarex-protocol/storage-authority";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
import { readBindingHead, readBindingCandidate } from "../../installation/frameworkSchema/binding/repository";
import { acceptCmsPreferences, type PreparedCmsPreferences } from "./admission";
import { cmsError, cmsLimits } from "../cmsTransaction/model";
import { applyPayloadPreferenceDeletionIntents, decodePayloadPreferenceDeletionIntents, type PayloadPreferenceDeletionIntent } from "./cleanup";
import { preparePayloadPreferenceDeletionFacts } from "./facts";

/** This owner is retained only by trusted source commit authority. Neither its
 * target nor its installation is lent to native callbacks or the application. */
export function makeSourcePayloadPreferenceCleanup(preferences: PreparedCmsPreferences,
  configuration: PayloadConfiguration, tables: readonly Readonly<{ localName: string; tableId: CatalogTableId }>[]) {
  return Object.freeze({ apply: Effect.fn("PayloadPreferences.applySourceCleanup")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    changes: LogicalDocumentChanges, input: readonly PayloadPreferenceDeletionIntent[],
  ) {
    const intents = yield* decodePayloadPreferenceDeletionIntents(input).pipe(
      Effect.mapError(cause => cmsError("invalidAuthority", cause)));
    if (new Set(intents.map(intent => intent.key)).size !== intents.length) return yield* Effect.fail(cmsError("invalidAuthority"));
    const head = yield* readBindingHead(tx, authority, "share").pipe(
      Effect.mapError(cause => cmsError(cause.reason === "resourceFailure" ? "resourceFailure" : "bindingChanged", cause)));
    if (Option.isNone(head)) return yield* Effect.fail(cmsError("bindingChanged"));
    const candidate = yield* readBindingCandidate(tx, authority, head.value.frame.candidateSha256).pipe(
      Effect.mapError(cause => cmsError(cause.reason === "resourceFailure" ? "resourceFailure" : "bindingChanged", cause)));
    if (Option.isNone(candidate)) return yield* Effect.fail(cmsError("bindingChanged"));
    const frame = candidate.value.frame;
    const availability = yield* acceptCmsPreferences(preferences, frame, tx, authority).pipe(
      Effect.mapError(cause => cmsError(cause.reason === "resourceFailure" ? "resourceFailure" : "bindingChanged", cause)));
    if (availability === null || frame.payloadLifecycle === null) return yield* Effect.fail(cmsError("invalidAuthority"));
    const requireDeletion = Effect.fn("PayloadPreferences.requireSourceDeletion")(function* (documentId: typeof AppDocumentIdV1Schema.Type) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId)).pipe(
        Effect.mapError(cause => cmsError("invalidAuthority", cause)));
      const table = tables.find(entry => entry.tableId === identity.tableId);
      const collection = configuration.tables.find(entry => entry.logicalTableName === table?.localName);
      const final = changes.changes.find(change => change.documentId === documentId);
      const last = changes.attempts.findLast(attempt => attempt.documentId === documentId);
      if (collection === undefined || last?.operation !== "delete" || last.after !== null ||
        (final?.kind !== "deleted" && !changes.noFinalRows.includes(documentId)))
        return yield* Effect.fail(cmsError("invalidAuthority"));
      return Object.freeze({ documentId, collectionSlug: collection.collectionSlug });
    });
    // This accepting-transaction budget is distinct from the already closed
    // callback lifetime. The shared SQL owner also bounds total identities.
    let charged = 0;
    const evidence = yield* applyPayloadPreferenceDeletionIntents({ tx, authority, availability, intents,
      lifetime: { charge: bytes => {
        charged += bytes;
        return charged > cmsLimits.commandBytes ? Result.fail(cmsError("limitExceeded")) : Result.succeed(undefined);
      } }, requireDeletion });
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId)).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
    const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch)).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
    const facts = yield* preparePayloadPreferenceDeletionFacts({ scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid,
      storageGeneration: authority.storageGeneration, artifactSha256: frame.payloadLifecycle.installation.artifact.artifactSha256,
      changes: changes.changes, evidence });
    return Object.freeze({ facts, evidence });
  }) });
}
export type SourcePayloadPreferenceCleanup = ReturnType<typeof makeSourcePayloadPreferenceCleanup>;
