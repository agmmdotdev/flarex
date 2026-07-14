import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";

import type { FlarexSqlClient } from "../src";
import type { PreparedPointMutationSessionActivationV1 } from "../src/transactionSessionActivation";

type ActivationEvidence = PreparedPointMutationSessionActivationV1["evidence"];

export interface ActivationFixtureOverrides {
  readonly deploymentId?: TransactionGrantDeploymentIdV1;
  readonly scopeId?: ReplacementScopeIdV1;
  readonly evidence?: Partial<ActivationEvidence>;
}

export function pointMutationSessionActivationFixture(
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeId: ReplacementScopeIdV1,
  overrides: ActivationFixtureOverrides = {},
): PreparedPointMutationSessionActivationV1 {
  const sourcePackageHash = TransactionSourcePackageSha256HexV1Schema.make(
    "a".repeat(64),
  );
  const evidence = overrides.evidence ?? {};
  return Object.freeze({
    deploymentId: overrides.deploymentId ?? deploymentId,
    scopeId: overrides.scopeId ?? scopeId,
    evidence: Object.freeze({
      packageId:
        evidence.packageId ??
        TransactionPackageIdV1Schema.make("package_activation_v1"),
      artifactRuntime:
        evidence.artifactRuntime ??
        TransactionArtifactRuntimeV1Schema.make("dynamic-worker"),
      artifactId:
        evidence.artifactId ??
        TransactionArtifactIdV1Schema.make(
          `artifact_${sourcePackageHash.slice(0, 32)}`,
        ),
      sourcePackageHash: evidence.sourcePackageHash ?? sourcePackageHash,
      executionModule:
        evidence.executionModule ??
        TransactionExecutionModuleV1Schema.make(
          "flarex/_generated/execution.mjs",
        ),
      functionPath:
        evidence.functionPath ??
        TransactionFunctionPathV1Schema.make("messages:create"),
      functionKind:
        evidence.functionKind ?? TransactionFunctionKindV1Schema.make("mutation"),
      schemaVersionId:
        evidence.schemaVersionId ??
        CatalogSchemaVersionIdSchema.make("schema_activation_v1"),
      policyVersion:
        evidence.policyVersion ??
        TransactionPolicyVersionV1Schema.make("policy_activation_v1"),
      identityAccessPolicySha256:
        evidence.identityAccessPolicySha256 ??
        TransactionIdentityAccessPolicySha256V1Schema.make(
          filledBytes(0x11, 32),
        ),
      validatedArgsJson:
        evidence.validatedArgsJson ?? Object.freeze({ body: "hello" }),
      validatedArgsValueCodecVersion:
        evidence.validatedArgsValueCodecVersion ??
        FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalBytes:
        evidence.validatedArgsCanonicalBytes ??
        CanonicalTransactionArgumentsBytesV1Schema.make(
          filledBytes(0x21, 3),
        ),
      validatedArgsSha256:
        evidence.validatedArgsSha256 ??
        TransactionArgumentsSha256V1Schema.make(filledBytes(0x22, 32)),
      authorizationGrantId:
        evidence.authorizationGrantId ??
        TransactionAuthorizationGrantIdV1Schema.make("grant_activation_v1"),
      authorizationGrantJson:
        evidence.authorizationGrantJson ?? Object.freeze({ grant: "signed" }),
      authorizationGrantValueCodecVersion:
        evidence.authorizationGrantValueCodecVersion ??
        FLAREX_VALUE_CODEC_VERSION_V1,
      authorizationGrantCanonicalBytes:
        evidence.authorizationGrantCanonicalBytes ??
        CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
          filledBytes(0x31, 3),
        ),
      authorizationGrantSha256:
        evidence.authorizationGrantSha256 ??
        TransactionAuthorizationGrantSha256V1Schema.make(
          filledBytes(0x32, 32),
        ),
      authorizationRevocationEpoch:
        evidence.authorizationRevocationEpoch ??
        TransactionAuthorizationRevocationEpochSchema.make(0n),
      authorizationGrantExpiresAt:
        evidence.authorizationGrantExpiresAt ??
        new Date("2099-01-01T00:00:00.000Z"),
      requestKey:
        evidence.requestKey ??
        TransactionRequestKeyV1Schema.make("request:activation:v1"),
      requestSha256:
        evidence.requestSha256 ??
        TransactionRequestSha256V1Schema.make(filledBytes(0x41, 32)),
    } satisfies ActivationEvidence),
  } satisfies PreparedPointMutationSessionActivationV1);
}

export async function setFlarexActivationClock(
  persistence: Pick<FlarexSqlClient, "query">,
  scopeId: ReplacementScopeIdV1,
  input: {
    readonly storageGenerationFence?: bigint;
    readonly lastCommitSeq?: bigint;
    readonly authorizationRevocationEpoch?: bigint;
  } = {},
): Promise<void> {
  await persistence.query(
    `
      update fx_system_scope_clock
      set storage_generation = 'flarexdb_v1',
          storage_generation_fence = $2,
          last_commit_seq = $3,
          authorization_revocation_epoch = $4,
          updated_at = clock_timestamp()
      where scope_id = $1
    `,
    [
      scopeId,
      input.storageGenerationFence ?? 1n,
      input.lastCommitSeq ?? 0n,
      input.authorizationRevocationEpoch ?? 0n,
    ],
  );
}

export function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID test sequence exhausted.");
    }
    return value;
  };
}

function filledBytes(value: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}
