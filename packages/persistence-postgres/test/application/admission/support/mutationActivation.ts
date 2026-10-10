import { applicationMutationActivationFixture } from "../../applicationMutationActivationFixture";
import { eq } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  type CoherentActiveApplication,
} from "../../../../src/application/activation/contracts";
import { runEffect } from "../../../support/effectTestRuntime";
import { fxSystemApplicationFunctionsV1 } from "../../../../src/database/schema";
import { readinessFixture } from "../../support/readinessFixture";
import { sha256Hex } from "../../support/readinessEvidence";

export async function applicationMutationActivationInput(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  active: CoherentActiveApplication,
  options: Readonly<{
    requestKey: string;
    grantId: string;
  }> = {
    requestKey: "request:application:mutation",
    grantId: "grant_application_mutation_1",
  },
) {
  const fn = active.basis.manifest.functions[0];
  if (fn === undefined || fn.kind !== "mutation") {
    throw new Error("Expected one Application mutation function.");
  }
  const rows = await fixture.target.drizzle.select({
    entrySha256: fxSystemApplicationFunctionsV1.entrySha256,
  }).from(fxSystemApplicationFunctionsV1).where(eq(
    fxSystemApplicationFunctionsV1.functionPath,
    fn.path,
  )).limit(1);
  const storedFunction = rows[0];
  if (storedFunction === undefined) {
    throw new Error("Expected stored Application mutation function.");
  }
  const runtimeTarget = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: active.basis.authority.scopeId,
    revisionId: active.basis.revisionId,
    candidateId: active.basis.candidateId,
    analysisId: active.basis.analysisId,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(active.basis.sourceArtifactRootSha256),
    manifestSha256: encodeBytesToLowercaseHex(active.basis.manifestSha256),
    schemaSha256: encodeBytesToLowercaseHex(active.basis.applicationSchemaSha256),
    functionCatalogSha256: encodeBytesToLowercaseHex(active.basis.functionCatalogSha256),
    publicationSha256: encodeBytesToLowercaseHex(active.basis.publicationSha256),
    executionModulePath: active.basis.manifest.sourceArtifact.executionModulePath,
    function: { ...fn, entrySha256: encodeBytesToLowercaseHex(storedFunction.entrySha256) },
  }));
  const executionAuthority = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256: await sha256Hex(runtimeTarget.canonicalBytes),
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: encodeBytesToLowercaseHex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
    }),
  );
  return applicationMutationActivationFixture({
    deploymentId: fixture.input.deploymentId, selection: active.selection,
    executionAuthority, requestKey: options.requestKey, grantId: options.grantId,
  });
}
