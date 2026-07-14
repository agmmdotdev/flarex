import type {
  PointMutationSessionActivationPersistenceV1,
  PointMutationSessionActivationResultV1,
  PreparedPointMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";

import {
  inspectAdmittedPointMutationStartV1,
  type AdmittedPointMutationStartV1,
} from "./transactionGrant";

const activatedPointMutationSessionBrand: unique symbol = Symbol(
  "FlarexExecutor/ActivatedPointMutationSessionV1",
);

/** Private B1 capability. It carries no caller-authored session authority. */
export interface ActivatedPointMutationSessionV1 {
  readonly [activatedPointMutationSessionBrand]: true;
}

export type ActivatedPointMutationSessionInspectionV1 =
  PointMutationSessionActivationResultV1;

const activatedSessionInspectionByHandle = new WeakMap<
  object,
  ActivatedPointMutationSessionInspectionV1
>();

export class InvalidActivatedPointMutationSessionV1Error extends Error {
  readonly name = "InvalidActivatedPointMutationSessionV1Error";

  constructor() {
    super("Value is not a process-local activated point-mutation session.");
  }
}

export interface PointMutationSessionActivationV1 {
  readonly activate: (
    admittedStart: AdmittedPointMutationStartV1,
  ) => Promise<ActivatedPointMutationSessionV1>;
}

export function createPointMutationSessionActivationV1(
  persistence: PointMutationSessionActivationPersistenceV1,
): PointMutationSessionActivationV1 {
  return Object.freeze({
    activate: async (
      admittedStart: AdmittedPointMutationStartV1,
    ): Promise<ActivatedPointMutationSessionV1> => {
      const admitted = inspectAdmittedPointMutationStartV1(admittedStart);
      const prepared = preparePersistenceActivation(admitted);
      const result = await persistence.activate(prepared);
      const handle = Object.freeze({
        [activatedPointMutationSessionBrand]: true as const,
      });
      activatedSessionInspectionByHandle.set(handle, result);
      return handle;
    },
  });
}

export function inspectActivatedPointMutationSessionV1(
  value: unknown,
): ActivatedPointMutationSessionInspectionV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  const inspection = activatedSessionInspectionByHandle.get(value);
  if (inspection === undefined) {
    throw new InvalidActivatedPointMutationSessionV1Error();
  }
  return inspection;
}

function preparePersistenceActivation(
  admitted: ReturnType<typeof inspectAdmittedPointMutationStartV1>,
): PreparedPointMutationSessionActivationV1 {
  const preparedStart = admitted.preparedStart;
  const pins = preparedStart.logicalPins;
  const grant = admitted.verifiedGrant.evidence;
  const payload = grant.payload;

  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    evidence: Object.freeze({
      packageId: pins.packageId,
      artifactRuntime: pins.artifactRuntime,
      artifactId: pins.artifactId,
      sourcePackageHash: pins.sourcePackageHash,
      executionModule: pins.executionModule,
      functionPath: pins.functionPath,
      functionKind: pins.functionKind,
      schemaVersionId: pins.schemaVersionId,
      policyVersion: payload.policyVersion,
      identityAccessPolicySha256:
        transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
          payload.identityAccessPolicySha256,
        ),
      validatedArgsJson: preparedStart.validatedArguments.valueJson,
      validatedArgsValueCodecVersion:
        pins.validatedArgsValueCodecVersion,
      validatedArgsCanonicalBytes:
        preparedStart.validatedArguments.canonicalBytes,
      validatedArgsSha256: preparedStart.validatedArguments.sha256,
      authorizationGrantId: grant.authorizationGrantId,
      authorizationGrantJson: grant.authorizationGrantJson,
      authorizationGrantValueCodecVersion:
        grant.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalBytes:
        grant.authorizationGrantCanonicalBytes,
      authorizationGrantSha256: grant.authorizationGrantSha256,
      authorizationRevocationEpoch: grant.authorizationRevocationEpoch,
      authorizationGrantExpiresAt: new Date(
        grant.authorizationGrantExpiresAt,
      ),
      requestKey: pins.requestKey,
      requestSha256: preparedStart.requestEvidence.sha256,
    }),
  } satisfies PreparedPointMutationSessionActivationV1);
}
