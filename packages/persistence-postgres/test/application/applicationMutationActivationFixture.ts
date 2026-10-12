import { Effect } from "effect";
import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  prepareApplicationMutationGrantV1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  verifyApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import type {
  ApplicationMutationGrantVerificationKeyV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import type {
  CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { canonicalizePointMutationRequestV1 } from "flarex-protocol/point-mutation-start";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1, canonicalizeFlarexValueJsonV1 } from "flarex-protocol/value";
import type {
  ApplicationActiveSelection,
} from "../../src/application/activation/contracts";
import type {
  PreparedApplicationMutationSessionActivationV1,
} from "../../src/execution/session/contracts";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../execution/session/support/activationEvidence";
import { runEffect } from "../support/effectTestRuntime";

/** Test issuer only. Production codecs, signature verification and activation
 * remain the authority owners; no session rows are installed by this helper. */
export async function applicationMutationActivationFixture(input: Readonly<{
  deploymentId: string;
  selection: ApplicationActiveSelection;
  executionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
  requestKey: string;
  grantId: string;
  validatedArgsJson?: Readonly<{ body: string }>;
  grantLifetimeMilliseconds?: number;
}>): Promise<PreparedApplicationMutationSessionActivationV1 & Readonly<{
  verificationKey: ApplicationMutationGrantVerificationKeyV1;
}>> {
  return Object.freeze({ ...(await applicationMutationActivationEvidenceFixture(input)), activeSelection: input.selection });
}

/** Same test grant issuer for private preparation; no provisional live selection. */
export async function applicationMutationActivationEvidenceFixture(input: Readonly<{
  deploymentId: string;
  executionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
  requestKey: string;
  grantId: string;
  validatedArgsJson?: Readonly<{ body: string }>;
  grantLifetimeMilliseconds?: number;
}>, runPreparedEffect: typeof runEffect = runEffect): Promise<Omit<PreparedApplicationMutationSessionActivationV1, "activeSelection"> & Readonly<{
  verificationKey: ApplicationMutationGrantVerificationKeyV1;
}>> {
  const now = Date.now();
  const grantLifetimeMilliseconds = input.grantLifetimeMilliseconds ?? 5 * 60_000;
  if (!isPositiveSafeInteger(grantLifetimeMilliseconds) || grantLifetimeMilliseconds > 5 * 60_000)
    throw new RangeError("Grant fixture lifetime must be between one millisecond and five minutes");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(input.deploymentId);
  const policyVersion = TransactionPolicyVersionV1Schema.make("policy_point_mutation_v1");
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({ policyVersion, auth: { kind: "anonymous" },
    capabilities: ["db:get", "db:insert", "db:patch", "db:replace", "db:delete"] });
  const validatedArgsJson = Object.freeze(input.validatedArgsJson ?? { body: "hello" });
  const args = await canonicalizeFlarexValueJsonV1(validatedArgsJson);
  const validatedArgsSha256 = TransactionArgumentsSha256V1Schema.make(args.sha256);
  const requestKey = TransactionRequestKeyV1Schema.make(input.requestKey);
  const functionPath = TransactionFunctionPathV1Schema.make(input.executionAuthority.authority.runtimeTarget.function.path);
  const requestSha256 = TransactionRequestSha256V1Schema.make((await canonicalizePointMutationRequestV1({
    deploymentId, functionPath, validatedArgsSha256, requestKey,
  })).sha256);
  const kid = TransactionGrantKeyIdV1Schema.make("application-key-1");
  const segments = await runPreparedEffect(prepareApplicationMutationGrantV1({ kid, deploymentId,
    grantId: TransactionAuthorizationGrantIdV1Schema.make(input.grantId), executionAuthority: input.executionAuthority,
    policyVersion, identityAccessPolicy: policy, validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256: encodeBytesToLowercaseHex(validatedArgsSha256), requestKey, requestSha256: encodeBytesToLowercaseHex(requestSha256),
    issuedAt: TransactionGrantTimestampV1Schema.make(new Date(now - 60_000).toISOString()),
    expiresAt: TransactionGrantTimestampV1Schema.make(new Date(now + grantLifetimeMilliseconds).toISOString()),
    authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(0n) }));
  const keys = await globalThis.crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  if (!("privateKey" in keys) || !("publicKey" in keys)) throw new Error("Expected Ed25519 key pair");
  const authorizationGrant = assembleApplicationMutationGrantJwsV1(segments,
    new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", keys.privateKey, copyBytesToArrayBuffer(segments.signingInput))));
  const verificationKey = Object.freeze({ kid, purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
    state: "active" as const, issuedAtInclusiveEpochMilliseconds: now - 60 * 60_000,
    publicKey: keys.publicKey });
  const verifiedGrant = await runPreparedEffect(verifyApplicationMutationGrantV1(authorizationGrant,
    createApplicationMutationGrantVerifierNamespaceV1({ deploymentId, grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      trustedNowEpochMilliseconds: Effect.succeed(now), keys: [verificationKey] })));
  const authority = input.executionAuthority.authority;
  const prepared: Omit<PreparedApplicationMutationSessionActivationV1, "activeSelection"> = { deploymentId, scopeId: decodeReplacementScopeIdV1(authority.runtimeTarget.scopeId),
    evidence: { executionAuthority: authority, verifiedGrant,
      functionPath,
      functionKind: TransactionFunctionKindV1Schema.make("mutation"), schemaVersionId: decodeCatalogSchemaVersionId(authority.schemaVersionId),
      policyVersion, identityAccessPolicySha256: transactionGrantIdentityAccessPolicySha256BytesV1FromHex(policy.sha256Hex),
      validatedArgsJson, validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalBytes: CanonicalTransactionArgumentsBytesV1Schema.make(args.canonicalBytes),
      validatedArgsSha256, requestKey, requestSha256 } };
  return Object.freeze({ ...prepared, verificationKey });
}
