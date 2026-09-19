import { Effect } from "effect";
import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1, prepareApplicationMutationGrantV1,
  assembleApplicationMutationGrantJwsV1, createApplicationMutationGrantVerifierNamespaceV1, verifyApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import type { CanonicalApplicationMutationExecutionAuthorityV1 } from "flarex-protocol/internal/application-mutation-authority-v1";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema, TransactionGrantKeyIdV1Schema, TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1, transactionGrantIdentityAccessPolicySha256BytesV1FromHex } from "flarex-protocol/transaction-grant";
import { CanonicalTransactionArgumentsBytesV1Schema, TransactionArgumentsSha256V1Schema, TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema, TransactionFunctionPathV1Schema, TransactionFunctionKindV1Schema,
  TransactionPolicyVersionV1Schema, TransactionRequestKeyV1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1, canonicalizeFlarexValueJsonV1 } from "flarex-protocol/value";
import type { ApplicationActiveSelection } from "../src/applicationActivation";
import type { PreparedApplicationMutationSessionActivationV1 } from "../src/transactionSessionActivation";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";
import { runEffect } from "./effectTestRuntime";

/** Test issuer only. Production codecs, signature verification and activation
 * remain the authority owners; no session rows are installed by this helper. */
export async function applicationMutationActivationFixture(input: Readonly<{
  deploymentId: string;
  selection: ApplicationActiveSelection;
  executionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
  requestKey: string;
  grantId: string;
}>): Promise<PreparedApplicationMutationSessionActivationV1> {
  const now = Date.now();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(input.deploymentId);
  const policyVersion = TransactionPolicyVersionV1Schema.make("policy_point_mutation_v1");
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({ policyVersion, auth: { kind: "anonymous" },
    capabilities: ["db:get", "db:insert", "db:patch", "db:replace", "db:delete"] });
  const validatedArgsJson = Object.freeze({ body: "hello" });
  const args = await canonicalizeFlarexValueJsonV1(validatedArgsJson);
  const validatedArgsSha256 = TransactionArgumentsSha256V1Schema.make(args.sha256);
  const requestSha256 = TransactionRequestSha256V1Schema.make(new Uint8Array(32).fill(0x41));
  const requestKey = TransactionRequestKeyV1Schema.make(input.requestKey);
  const kid = TransactionGrantKeyIdV1Schema.make("application-key-1");
  const segments = await runEffect(prepareApplicationMutationGrantV1({ kid, deploymentId,
    grantId: TransactionAuthorizationGrantIdV1Schema.make(input.grantId), executionAuthority: input.executionAuthority,
    policyVersion, identityAccessPolicy: policy, validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256: encodeBytesToLowercaseHex(validatedArgsSha256), requestKey, requestSha256: encodeBytesToLowercaseHex(requestSha256),
    issuedAt: TransactionGrantTimestampV1Schema.make(new Date(now - 60_000).toISOString()),
    expiresAt: TransactionGrantTimestampV1Schema.make(new Date(now + 5 * 60_000).toISOString()),
    authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(0n) }));
  const keys = await globalThis.crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  if (!("privateKey" in keys) || !("publicKey" in keys)) throw new Error("Expected Ed25519 key pair");
  const authorizationGrant = assembleApplicationMutationGrantJwsV1(segments,
    new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", keys.privateKey, copyBytesToArrayBuffer(segments.signingInput))));
  const verifiedGrant = await runEffect(verifyApplicationMutationGrantV1(authorizationGrant,
    createApplicationMutationGrantVerifierNamespaceV1({ deploymentId, grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      trustedNowEpochMilliseconds: Effect.succeed(now), keys: [{ kid, purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "active", issuedAtInclusiveEpochMilliseconds: now - 60 * 60_000, publicKey: keys.publicKey }] })));
  const authority = input.executionAuthority.authority;
  return { deploymentId, scopeId: decodeReplacementScopeIdV1(authority.runtimeTarget.scopeId), activeSelection: input.selection,
    evidence: { executionAuthority: authority, verifiedGrant,
      functionPath: TransactionFunctionPathV1Schema.make(authority.runtimeTarget.function.path),
      functionKind: TransactionFunctionKindV1Schema.make("mutation"), schemaVersionId: decodeCatalogSchemaVersionId(authority.schemaVersionId),
      policyVersion, identityAccessPolicySha256: transactionGrantIdentityAccessPolicySha256BytesV1FromHex(policy.sha256Hex),
      validatedArgsJson, validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalBytes: CanonicalTransactionArgumentsBytesV1Schema.make(args.canonicalBytes),
      validatedArgsSha256, requestKey, requestSha256 } };
}
