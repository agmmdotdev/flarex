import {
  createExecutorPointMutationStartPreparationV1,
} from "@flarex/executor/point-mutation-start";
import {
  createPointMutationStartAdmissionV1,
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
  inspectAdmittedPointMutationStartV1,
  inspectVerifiedTransactionGrantV1,
} from "@flarex/executor/transaction-grant";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { Effect, Result } from "effect";

const TEST_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAno+3aYSLpdF45q6y9wrLdVOEWJLjvbGTDmfTVRqLEZ8=";
const TEST_DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2b",
);
const TEST_SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const TEST_AUTHORIZATION_REVOCATION_EPOCH =
  TransactionAuthorizationRevocationEpochSchema.make(7n);
const TEST_TARGET_METADATA = deepFreezeProjection({
  format: "flarex.point-mutation-target-metadata",
  version: 1,
  deploymentId: TEST_DEPLOYMENT_ID,
  scopeId: TEST_SCOPE_ID,
  packageId: "package_a2b",
  artifactRuntime: "dynamic-worker",
  artifactId: `artifact_${"a".repeat(32)}`,
  sourcePackageHash: "a".repeat(64),
  schemaVersionId: "schema_a2b",
  functions: [{
    path: "orders:create",
    executionModule: "flarex/orders.ts",
    kind: "mutation",
    visibility: "public",
    argsValidator: {
      type: "object",
      value: {
        orderId: {
          fieldType: { type: "string" },
          optional: false,
        },
      },
    },
    returnsValidator: null,
  }],
  schemaManifest: {
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [],
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: [],
    },
  },
});
const TEST_CURRENT_SCOPE_AUTHORITY = Object.freeze({
  deploymentId: TEST_DEPLOYMENT_ID,
  scopeId: TEST_SCOPE_ID,
  authorizationRevocationEpoch: TEST_AUTHORIZATION_REVOCATION_EPOCH,
});
const TEST_GRANT_RETENTION_POLICY = Result.getOrThrow(
  makeGrantRetentionPolicyV1Result({
    maximumGrantLifetimeMilliseconds: 60_000,
    maximumFutureIssuedAtSkewMilliseconds: 0,
    maximumLiveSnapshotRetentionMilliseconds: 60_000,
  }),
);

export default {
  async fetch(request: Request): Promise<Response> {
    const body = requiredRecord(await request.json());
    const candidate = requiredRecord(body.candidate);
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      requiredString(candidate.deploymentId),
    );
    const preparation = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => TEST_TARGET_METADATA,
      loadCurrentScopeAuthority: async () => TEST_CURRENT_SCOPE_AUTHORITY,
    });
    const expectedStart = await preparation.prepare({
      deploymentId,
      functionPath: TransactionFunctionPathV1Schema.make(
        requiredString(candidate.functionPath),
      ),
      args: candidate.args,
      requestKey: TransactionRequestKeyV1Schema.make(
        requiredString(candidate.requestKey),
      ),
    });
    const publicKey = await importPublicKey();
    const keyNamespace = createTransactionGrantVerificationKeyNamespaceV1({
      deploymentId,
      keys: [{
        state: "active",
        kid: TransactionGrantKeyIdV1Schema.make(requiredString(body.keyId)),
        purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
        issuedAtInclusiveEpochMilliseconds: requiredNumber(
          body.keyIssuedAtInclusiveEpochMilliseconds,
        ),
        verify: (signingInput, signature) => crypto.subtle.verify(
          { name: "Ed25519" },
          publicKey,
          copyBytesToArrayBuffer(signature),
          copyBytesToArrayBuffer(signingInput),
        ),
      }],
    });
    const verifier = createTransactionGrantVerifierV1({
      clock: { now: () => new Date(requiredString(body.now)) },
      verificationKeyNamespace: keyNamespace,
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY,
    });
    const verified = await verifier.verify({
      jws: body.jws,
      expectedStart,
    });
    const admitted = await Effect.runPromise(
      createPointMutationStartAdmissionV1({
        resolveCurrent: () => Effect.succeed(TEST_CURRENT_SCOPE_AUTHORITY),
      }).admit(verified),
    );
    const inspection = inspectVerifiedTransactionGrantV1(verified);
    inspectAdmittedPointMutationStartV1(admitted);
    return Response.json({
      grantId: inspection.evidence.payload.grantId,
      keyId: inspection.verificationKeyId,
      authKind: inspection.evidence.payload.auth.kind,
      authorizationRevocationEpoch:
        inspection.evidence.payload.authorizationRevocationEpoch.toString(),
      verifiedAt: inspection.verifiedAt,
    });
  },
};

async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    copyBytesToArrayBuffer(decodeBase64(TEST_PUBLIC_KEY_SPKI_BASE64)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

function requiredRecord(value: unknown): UnknownRecord {
  if (isNonArrayRecord(value)) return value;
  throw new Error("Expected an object.");
}

function requiredString(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error("Expected a nonempty string.");
}

function requiredNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Expected a finite number.");
}

function requireLiteral<T extends string | number>(
  value: unknown,
  expected: T,
): asserts value is T {
  if (value !== expected) throw new Error("Expected a fixed literal.");
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function deepFreezeProjection<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeProjection(descriptor.value);
    }
  }
  Object.freeze(value);
  return value;
}
