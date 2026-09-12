import { Effect } from "effect";
import type { CanonicalSuccessfulResultV1 } from "flarex-protocol/commit-protocol";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import type { ApplicationParticipantOptions } from "../applicationDocumentMaterialization/participant";
import type { ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import {
  allocateScopePublicationResult,
  readScopePublicationDatabaseTime,
  writeScopePublicationPrefix,
  advanceScopePublicationClock,
} from "../commitPublication/publication";
import type {
  ScopePublicationClock,
  ScopePublicationContribution,
  ScopePublicationKernel,
} from "../commitPublication/scopePublicationModel";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runOwnedPromise } from "../ownedPromise";
import { compositeError, projectCompositePublicationFailure } from "./model";
import type { makeCurrencyAnnouncementParticipants } from "./participants";

type Participants = Effect.Success<
  ReturnType<typeof makeCurrencyAnnouncementParticipants>
>;
interface PublicationInput {
  readonly tx: FlarexMetadataTransaction;
  readonly scopeId: ReplacementScopeIdV1;
  readonly clock: ScopePublicationClock;
  readonly materialization: ApplicationParticipantOptions;
  readonly identity: ResolveCommittedPointOutcomeInputV1;
  readonly closed: Effect.Success<ReturnType<Participants["close"]>>;
  readonly result: CanonicalSuccessfulResultV1;
  readonly resultSha256: Uint8Array;
}
const publication = <A>(work: (signal: AbortSignal) => Promise<A>) =>
  runOwnedPromise(work, projectCompositePublicationFailure);

/** Publish the authenticated combined delta; physical settlement remains with the session. */
export const publishCurrencyAnnouncement = Effect.fn(
  "CurrencyAnnouncement.publish",
)(function* (input: PublicationInput) {
  const {
    tx,
    scopeId,
    clock,
    materialization,
    identity,
    closed,
    result,
    resultSha256,
  } = input;
  const now = yield* publication(() =>
    readScopePublicationDatabaseTime(tx, scopeId, materialization),
  );
  const allocation = yield* Effect.fromResult(
    allocateScopePublicationResult(clock, now),
  );
  const adjacency = yield* closed.delta.lower(allocation.commitSeq);
  const contribution: ScopePublicationContribution = {
    authorityPins: {
      scopeId,
      requestKey: identity.requestKey,
      functionPath: identity.expectedFunctionPath,
    },
    rowIntents: closed.changes,
    relationalFacts: closed.relationalFacts,
    identityAccessPolicySha256: identity.expectedIdentityAccessPolicySha256,
    requestSha256: identity.expectedRequestSha256,
    resultSha256,
    successfulResult: { ...result, encoding: "application-value" },
  };
  const kernel: ScopePublicationKernel = {
    clock,
    ...allocation,
    relationAdjacencyChanges: adjacency,
  };
  yield* publication((signal) =>
    writeScopePublicationPrefix(
      tx,
      contribution,
      kernel,
      materialization,
      signal,
    ),
  );
  yield* publication(() =>
    advanceScopePublicationClock(tx, contribution, kernel, materialization),
  );
  return result.valueJson;
});
