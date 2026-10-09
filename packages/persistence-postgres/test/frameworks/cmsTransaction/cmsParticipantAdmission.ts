import { Effect } from "effect";
import { expect } from "vitest";
import { enterApplicationDocumentParticipant, readPreparedApplicationDocumentParticipant } from "../../../src/storage/materialization/participant";
import {
  prepareCmsApplicationFromBinding,
  requirePreparedCmsApplication,
  withCmsAdmission,
} from "../../../src/frameworks/cmsTransaction/admission";
import {
  enterCmsApplicationCommit,
  prepareCmsApplicationCommit,
  readPreparedCmsApplicationCommit,
} from "../../../src/frameworks/cmsTransaction/publication";
import type { CmsHostInput } from "../../../src/frameworks/cmsTransaction/host";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../src/scope/scopeAuthorityResolution";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { orderedIndexCompositionRefusals } from "../../storage/indexes/orderedIndexCompositionRefusals";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { prepareApplicationBindingSelection } from "../../../src/application/applicationActivation";
import { captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect } from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { runRelationalSession } from "../../../src/database/relationalTransaction/session";

/** The extracted participant must reject structural copies and expired admission. */
export async function assertCmsParticipantAdmission<Failure>(
  input: CmsHostInput<Failure>,
) {
  const { authority } = await runEffect(resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: input.deploymentId, scopeId: input.scopeId }, input.authority));
  // An unused foreign catalog tests exact issuer identity; refused ports must
  // never reach that database on either physical-driver lane.
  const foreign = await createMigratedPGlitePersistence();
  const retained = await runEffect(retainPreparedHost(input.hostRuntime, Effect.gen(function* () {
    const selection = yield* prepareApplicationBindingSelection(input.application);
    const application = yield* prepareCmsApplicationFromBinding(selection, input.controlDatabase, input.deploymentId, input.scopeId);
    const applicationState = yield* requirePreparedCmsApplication(application);
    const planningHead = yield* runRelationalSession(input.session, "snapshotRead", tx =>
      captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx, authority, input.pointCommitAuthority));
    const { intrinsicCreationTimeIndexes, developerIndexes, ...otherOptions } = input.materialization;
    if (!intrinsicCreationTimeIndexes || !developerIndexes) throw new Error("Expected valid participant index ports");
    for (const invalid of orderedIndexCompositionRefusals(intrinsicCreationTimeIndexes, developerIndexes, foreign.drizzle)) {
      expect(yield* Effect.flip(prepareCmsApplicationCommit(application, input.controlDatabase, authority,
        input.pointCommitAuthority, { ...otherOptions, ...invalid }, planningHead))).toMatchObject({ reason: "invalidAuthority" });
    }
    expect(yield* Effect.flip(prepareCmsApplicationCommit({ ...application },
      input.controlDatabase, authority, input.pointCommitAuthority, input.materialization, planningHead)))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(yield* Effect.flip(prepareCmsApplicationCommit(application, foreign.drizzle, authority,
      input.pointCommitAuthority, input.materialization, planningHead))).toMatchObject({ reason: "invalidAuthority" });
    const prepared = yield* prepareCmsApplicationCommit(application, input.controlDatabase, authority,
      input.pointCommitAuthority, input.materialization, planningHead);
    const preparedState = yield* readPreparedCmsApplicationCommit(prepared);
    const participantState = yield* readPreparedApplicationDocumentParticipant(preparedState.core);
    expect(yield* Effect.flip(readPreparedApplicationDocumentParticipant({ ...preparedState.core })))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(participantState.schema).toBe(applicationState.schema);
    expect(participantState.intrinsic).toBe(applicationState.intrinsicDefinitions);
    expect(participantState.developer).toBe(applicationState.indexDefinitions);
    expect(participantState.unique).toBe(applicationState.uniqueDefinitions);
    return { application, applicationState, prepared, preparedState };
  })));
  const { application, applicationState, prepared, preparedState } = await runEffect(retained.use(value => Effect.succeed(value)));
  try {
    await input.database.transaction((tx) =>
      runEffect(
        Effect.gen(function* () {
          const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId);
          const lifetime = yield* makeCmsRequestLifetime(
            { hostId: Symbol("participant-test") },
            { requestId: Symbol("participant-test") },
            "participant-test",
            "write",
          );
          yield* Effect.gen(function* () {
            const escaped = yield* withCmsAdmission(
              application,
              tx,
              authority,
              clock,
              (admission) =>
                Effect.gen(function* () {
                  const copiedPreparation = yield* Effect.result(
                    enterCmsApplicationCommit(
                      { ...prepared },
                      admission,
                      lifetime,
                    ),
                  );
                  expect(copiedPreparation).toMatchObject({
                    _tag: "Failure",
                    failure: { reason: "invalidAuthority" },
                  });
                  const copiedAdmission = yield* Effect.result(
                    enterCmsApplicationCommit(
                      prepared,
                      { ...admission },
                      lifetime,
                    ),
                  );
                  expect(copiedAdmission).toMatchObject({
                    _tag: "Failure",
                    failure: { reason: "invalidAuthority" },
                  });
                  // The typed opening FK and maintained-delete guard now protect
                  // this actual build. Exercise the materializer in the admitted
                  // transaction without a privileged destructive fixture mutation.
                  yield* enterApplicationDocumentParticipant(preparedState.core, tx, authority, clock, applicationState.schema);
                  yield* enterCmsApplicationCommit(prepared, admission, lifetime);
                  return admission;
                }),
            );
            const expired = yield* Effect.result(
              enterCmsApplicationCommit(prepared, escaped, lifetime),
            );
            expect(expired).toMatchObject({
              _tag: "Failure",
              failure: { reason: "invalidAuthority" },
            });
          }).pipe(Effect.ensuring(lifetime.close));
        }),
      ),
    );
  } finally { await runEffect(retained.close); }
  expect(await runEffectFailure(requirePreparedCmsApplication(application))).toMatchObject({ reason: "invalidAuthority" });
  expect(await runEffectFailure(readPreparedCmsApplicationCommit(prepared))).toMatchObject({ reason: "invalidAuthority" });
  expect(await runEffectFailure(readPreparedApplicationDocumentParticipant(preparedState.core))).toMatchObject({ reason: "invalidAuthority" });
}
