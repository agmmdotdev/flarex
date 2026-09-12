import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import {
  projectScopeIdUuidV1Result,
  projectScopeEpochUuidV1Result,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
} from "flarex-protocol/transaction-session";
import type { ApplicationBindingSelectionReader } from "../applicationActivation";
import {
  prepareApplicationDocumentParticipant,
  enterApplicationDocumentParticipant,
  type ApplicationParticipantOptions,
} from "../applicationDocumentMaterialization/participant";
import { makeBoundedRequestLifetime } from "../boundedRequestLifetime";
import {
  prepareCmsApplication,
  requireCmsAdmission,
  withCmsAdmission,
  type CmsAdmission,
} from "../cmsTransaction/admission";
import {
  getCmsCommand,
  type CmsCommand,
  type CmsHostInput,
} from "../cmsTransaction/host";
import { cmsLimits } from "../cmsTransaction/model";
import {
  getCommerceCommand,
  type CommerceCommand,
} from "../commerceTransaction/commands";
import {
  requireCommerceProfile,
  type CommerceProfile,
} from "../commerceTransaction/profile";
import {
  withCommerceAdmission,
  type CommerceAdmission,
} from "../commerceTransaction/admission";
import type { FlarexMetadataDatabase } from "../deployments";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { isSyntheticBindingReference } from "../frameworkSchema/binding/canonical";
import type { InstallationBindingReference } from "../frameworkSchema/binding/model";
import {
  hasFrameworkMigrationTargetDatabase,
  type FrameworkMigrationTarget,
} from "../migrationCoordination/targetSession";
import { capturePrivateJsonData } from "../privateJsonData";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityResolutionPorts,
} from "../scopeAuthorityResolution";
import {
  hasRelationalSessionDatabase,
  runRelationalSession,
  type RelationalSession,
} from "../relationalTransaction/session";
import { runWithRequestRecovery } from "../relationalTransaction/requestRecovery";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type ScopeClockRecord,
} from "../scopeClock";
import { createCommittedPointOutcomeResolverV1 } from "../committedPointOutcome";
import { withCompositeBinding } from "./binding";
import {
  compositeError,
  projectCompositeFailure,
  type CompositeFailure,
} from "./model";
import { makeCurrencyAnnouncementParticipants } from "./participants";
import { publishCurrencyAnnouncement } from "./publication";
import {
  captureCurrencyAnnouncementRequest,
  hashCurrencyAnnouncement,
} from "./request";
import type { CurrencyAnnouncementTestHooks } from "./testSupport";

/** Trusted inputs for the fixed Currency + scalar CMS + Application command. */
export interface CurrencyAnnouncementHostInput<Failure> {
  readonly database: FlarexMetadataDatabase;
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly application: ApplicationBindingSelectionReader<Failure>;
  /** Replay equivalence evidence; application authorization remains with the caller. */
  readonly identityAndAccessPolicy: Json;
  readonly materialization: ApplicationParticipantOptions;
  readonly expectedContentIdentity: NonNullable<
    CmsHostInput<Failure>["expectedContentIdentity"]
  >;
  readonly commerce: {
    readonly target: FrameworkMigrationTarget;
    readonly profile: CommerceProfile;
    readonly installation: InstallationBindingReference;
  };
  readonly currencyCommand: CommerceCommand;
  readonly cmsCommand: CmsCommand;
  readonly applicationTable: string;
}

/** Dynamic, trusted host instance; no framework callback or SQL handle is exposed. */
export const makeCurrencyAnnouncementHost = Effect.fn(
  "CurrencyAnnouncement.make",
)(function* <Failure>(
  input: CurrencyAnnouncementHostInput<Failure>,
  hooks?: CurrencyAnnouncementTestHooks,
) {
  const {
    database,
    controlDatabase,
    session,
    deploymentId,
    application,
    pointCommitAuthority,
    applicationTable,
  } = input;
  const capturedInstallation = yield* Effect.fromResult(
    capturePrivateJsonData(input.commerce.installation, 65_536, compositeError),
  );
  if (!isSyntheticBindingReference(capturedInstallation.value))
    return yield* Effect.fail(compositeError("invalidInput"));
  const commerce = Object.freeze({
    target: input.commerce.target,
    profile: input.commerce.profile,
    installation: capturedInstallation.value,
  });
  const currency = getCommerceCommand(input.currencyCommand);
  const cms = getCmsCommand(input.cmsCommand);
  if (
    currency?.name !== "currencyAnnouncementWrite" ||
    currency.mode !== "write" ||
    cms?.name !== "payload-create" ||
    cms.mode !== "write" ||
    !hasRelationalSessionDatabase(session, database) ||
    !hasFrameworkMigrationTargetDatabase(commerce.target, database)
  ) {
    return yield* Effect.fail(compositeError("invalidAuthority"));
  }
  const descriptor = yield* requireCommerceProfile(commerce.profile);
  if (
    descriptor.profileId !== "medusa.currency" ||
    descriptor.localOnly ||
    descriptor.initialization === null
  ) {
    return yield* Effect.fail(compositeError("unsupportedProfile"));
  }
  const compositionAuthority = input.authority;
  const authority = captureTrustedScopeAuthorityResolutionPorts(
    input.authority,
  );
  const materialization = Object.freeze({ ...input.materialization });
  // Keep the runtime absence refusal at admission for callers outside TypeScript.
  const expectedContent =
    input.expectedContentIdentity === undefined
      ? undefined
      : Object.freeze({ ...input.expectedContentIdentity });
  const accessPolicy = yield* Effect.fromResult(
    capturePrivateJsonData(
      input.identityAndAccessPolicy,
      65_536,
      compositeError,
    ),
  );
  const identity = yield* canonicalizeSuccessfulResultV1Effect(
    accessPolicy.value,
  );
  const identityDigest = TransactionIdentityAccessPolicySha256V1Schema.make(
    yield* hashCurrencyAnnouncement(identity.canonicalBytes),
  );
  const owner = Object.freeze({});

  const run = Effect.fn("CurrencyAnnouncement.run")(function* (
    requestKey: string,
    args: Json,
  ): Effect.fn.Return<Json, CompositeFailure> {
    const request = yield* captureCurrencyAnnouncementRequest(requestKey, args);
    const attempt = Effect.fn("CurrencyAnnouncement.attempt")(function* (
      recoverOnly: boolean,
    ) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        deploymentId,
        authority,
      );
      if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
        return yield* Effect.fail(compositeError("invalidAuthority"));
      const prepared = yield* prepareCmsApplication(
        application,
        compositionAuthority,
        controlDatabase,
        deploymentId,
      );
      if (prepared.schema.relations.length !== 0)
        return yield* Effect.fail(compositeError("unsupportedProfile"));
      const appTable = prepared.schema.tables.find(
        (table) => table.logicalName === applicationTable,
      );
      if (
        appTable === undefined ||
        !prepared.schema.writePolicy?.writePolicies.some(
          (policy) =>
            policy.tableId === appTable.tableId &&
            policy.owner === "application",
        )
      ) {
        return yield* Effect.fail(compositeError("invalidAuthority"));
      }
      const tableIds = [
        ...prepared.schema.writePolicy.writePolicies
          .filter((policy) => policy.owner === "payload")
          .map((policy) => policy.tableId),
        appTable.tableId,
      ];
      const documents = yield* prepareApplicationDocumentParticipant(
        prepared.schema,
        located.authority,
        pointCommitAuthority,
        materialization,
        tableIds,
      );

      const runAdmitted = Effect.fn("CurrencyAnnouncement.runAdmitted")(
        function* (
          cmsAdmission: CmsAdmission,
          commerceAdmission: CommerceAdmission,
          clock: ScopeClockRecord,
        ) {
          const admitted = yield* requireCmsAdmission(cmsAdmission);
          if (
            expectedContent === undefined ||
            admitted.frame.payloadContent?.configSha256 !==
              expectedContent.configSha256 ||
            admitted.frame.payloadContent.provenanceSha256 !==
              expectedContent.provenanceSha256
          ) {
            return yield* Effect.fail(compositeError("invalidAuthority"));
          }
          const scope = yield* Effect.fromResult(
            projectScopeIdUuidV1Result(located.authority.scopeId),
          );
          const epoch = yield* Effect.fromResult(
            projectScopeEpochUuidV1Result(clock.epoch),
          );
          const evidence = yield* canonicalizeSuccessfulResultV1Effect({
            domain: "flarex.private.currency-announcement",
            version: 1,
            deploymentId,
            scopeId: located.authority.scopeId,
            epoch: clock.epoch,
            generation: clock.storageGeneration,
            fence: clock.storageGenerationFence.toString(),
            binding: admitted.frame,
            head: admitted.head,
            applicationTable,
            args: request.captured.value,
          });
          const lookup = {
            scopeUuid: scope.scopeUuid,
            requestKey: request.key,
            expectedIdentityAccessPolicySha256: identityDigest,
            expectedFunctionPath: TransactionFunctionPathV1Schema.make(
              "__flarex_private_composite/publishCurrencyAnnouncement",
            ),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(
              yield* hashCurrencyAnnouncement(evidence.canonicalBytes),
            ),
          };
          const outcome = yield* createCommittedPointOutcomeResolverV1(
            admitted.tx,
          ).resolve(lookup);
          if (outcome.kind === "available")
            return outcome.successfulResult.valueJson;
          if (outcome.kind === "expired")
            return yield* Effect.fail(compositeError("resultUnavailable"));
          if (recoverOnly)
            return yield* Effect.fail(compositeError("decisionUncertain"));

          const transactionId = crypto.randomUUID();
          const lifetime = yield* makeBoundedRequestLifetime<
            CompositeFailure,
            object,
            object
          >(
            compositeError,
            cmsLimits,
            owner,
            Object.freeze({}),
            transactionId,
            "write",
          );
          return yield* Effect.gen(function* () {
            yield* Effect.fromResult(
              lifetime.charge(
                request.captured.bytes + evidence.canonicalBytes.byteLength,
              ),
            );
            const lowering = yield* enterApplicationDocumentParticipant(
              documents,
              admitted.tx,
              located.authority,
              clock,
              prepared.schema,
            );
            const participants = yield* makeCurrencyAnnouncementParticipants(
              {
                cmsAdmission,
                cmsState: admitted,
                commerceAdmission,
                lifetime,
                transactionId,
                applicationTable,
                lowering,
                currency,
                cms,
              },
              hooks,
            );
            const result = yield* participants.execute(request.argumentsValue);
            yield* Effect.fromResult(
              lifetime.charge(result.canonicalBytes.byteLength),
            );
            const resultSha256 = yield* hashCurrencyAnnouncement(
              result.canonicalBytes,
            );
            yield* lifetime.seal;
            const closed = yield* participants.close();
            return yield* publishCurrencyAnnouncement({
              tx: admitted.tx,
              scopeId: scope.scopeId,
              clock: {
                record: clock,
                scopeUuid: scope.scopeUuid,
                epochUuid: epoch.epochUuid,
              },
              materialization,
              identity: lookup,
              closed,
              result,
              resultSha256,
            });
          }).pipe(
            Effect.timeoutOrElse({
              duration: cmsLimits.commandMs,
              orElse: () => Effect.fail(compositeError("deadlineExceeded")),
            }),
            Effect.ensuring(lifetime.close),
          );
        },
      );

      // Keep physical entry, lock order and borrowed admission scopes visible together.
      return yield* runRelationalSession(session, (tx) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* runDrizzleStatementEffect(
              tx.execute(
                sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
              ),
              (cause) => compositeError("resourceFailure", cause),
            );
            const clock = yield* lockScopeClockForUpdateInTransactionEffect(
              tx,
              located.authority.scopeId,
            );
            return yield* withCommerceAdmission(
              commerce.profile,
              commerce.target,
              commerce.installation,
              prepared.selection,
              tx,
              located.authority,
              clock,
              false,
              undefined,
              (commerceAdmission, accepted) =>
                accepted === undefined ? Effect.fail(compositeError("invalidAuthority")) : withCompositeBinding(commerceAdmission, (binding) =>
                  withCmsAdmission(
                    prepared,
                    tx,
                    located.authority,
                    clock,
                    (cmsAdmission) =>
                      runAdmitted(cmsAdmission, commerceAdmission, clock),
                    undefined,
                    hooks?.bindingProof?.(binding) ?? binding,
                    accepted,
                  ),
                ),
            );
          }),
        ),
      );
    });
    return yield* runWithRequestRecovery(attempt, {
      hasRequestKey: true,
      projectFailure: projectCompositeFailure,
      isDecisionUncertain: (error) => error.reason === "decisionUncertain",
    });
  });
  return Object.freeze({
    newRequestKey: () => `composite/${crypto.randomUUID()}`,
    run,
  });
});
