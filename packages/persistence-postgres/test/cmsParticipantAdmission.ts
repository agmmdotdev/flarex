import { Effect } from "effect";
import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { fxSystemIndexBuildStates } from "../src/schema";
import { enterApplicationDocumentParticipant } from "../src/applicationDocumentMaterialization/participant";
import {
  prepareCmsApplication,
  withCmsAdmission,
} from "../src/cmsTransaction/admission";
import {
  enterCmsApplicationCommit,
  prepareCmsApplicationCommit,
} from "../src/cmsTransaction/publication";
import type { CmsHostInput } from "../src/cmsTransaction/host";
import { makeCmsRequestLifetime } from "../src/cmsTransaction/lifetime";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../src/scopeAuthorityResolution";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { orderedIndexCompositionRefusals } from "./orderedIndexCompositionRefusals";

/** The extracted participant must reject structural copies and expired admission. */
export async function assertCmsParticipantAdmission<Failure>(
  input: CmsHostInput<Failure>,
) {
  const { authority } = await runEffect(resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: input.deploymentId, scopeId: input.scopeId }, input.authority));
  const application = await runEffect(
    prepareCmsApplication(
      input.application,
      input.authority,
      input.controlDatabase,
      input.deploymentId,
      input.scopeId,
    ),
  );
  const prepared = await runEffect(
    prepareCmsApplicationCommit(
      application,
      input.controlDatabase,
      authority,
      input.pointCommitAuthority,
      input.materialization,
    ),
  );
  const { intrinsicCreationTimeIndexes, developerIndexes, ...otherOptions } = input.materialization;
  if (!intrinsicCreationTimeIndexes || !developerIndexes) throw new Error("Expected valid participant index ports");
  const payloadTable = application.schema.writePolicy?.writePolicies.find(policy => policy.owner === "payload");
  if (payloadTable === undefined) throw new Error("Expected managed participant table");
  const intrinsic = await runEffect(intrinsicCreationTimeIndexes.locate({ deploymentId: input.deploymentId,
    scopeId: authority.scopeId, tableId: payloadTable.tableId }));
  if (intrinsic === null) throw new Error("Expected managed table creation-time definition");
  // An unused foreign catalog tests exact issuer identity; refused ports must
  // never reach that database on either physical-driver lane.
  const foreign = await createMigratedPGlitePersistence();
  for (const invalid of orderedIndexCompositionRefusals(intrinsicCreationTimeIndexes, developerIndexes, foreign.drizzle)) {
    expect(await runEffectFailure(prepareCmsApplicationCommit(application, input.controlDatabase, authority,
      input.pointCommitAuthority, { ...otherOptions, ...invalid }))).toMatchObject({ reason: "invalidAuthority" });
  }
  expect(await runEffectFailure(prepareCmsApplicationCommit({ ...application, schema: { ...application.schema } },
    input.controlDatabase, authority, input.pointCommitAuthority, input.materialization)))
    .toMatchObject({ reason: "invalidAuthority" });
  expect(await runEffectFailure(prepareCmsApplicationCommit(application, foreign.drizzle, authority,
    input.pointCommitAuthority, input.materialization))).toMatchObject({ reason: "invalidAuthority" });
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
                // Admission is already authenticated: prove the shared materializer
                // refuses the missing build instead of relying on readiness to fail.
                const removed = yield* Effect.promise(() => tx.delete(fxSystemIndexBuildStates).where(and(
                  eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
                  eq(fxSystemIndexBuildStates.indexDefinitionId, intrinsic.indexDefinitionId),
                )).returning());
                expect(removed).toHaveLength(1);
                // The materializer now enters at settlement, after publication
                // exclusion. Exercise that owner directly under this locked fixture.
                const missingBuild = yield* Effect.result(enterApplicationDocumentParticipant(
                  prepared.core, tx, authority, clock, application.schema));
                expect(missingBuild).toMatchObject({ _tag: "Failure", failure: {
                  reason: "storedCorruption", cause: { reason: "intrinsicIndexBuildInvalid" },
                } });
                yield* Effect.promise(() => tx.insert(fxSystemIndexBuildStates).values(removed));
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
}
