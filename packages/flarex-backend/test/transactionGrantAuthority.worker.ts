import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
  inspectVerifiedTransactionGrantV1,
} from "@flarex/executor/transaction-grant";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantRequestSha256HexV1Schema,
  TransactionGrantValidatedArgsSha256HexV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArtifactIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { FlarexValueCodecVersionSchema } from "flarex-protocol/value";

const TEST_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAno+3aYSLpdF45q6y9wrLdVOEWJLjvbGTDmfTVRqLEZ8=";

export default {
  async fetch(request: Request): Promise<Response> {
    const body = requiredRecord(await request.json());
    const pins = requiredRecord(body.expectedPins);
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      requiredString(pins.deploymentId),
    );
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
          copyToArrayBuffer(signature),
          copyToArrayBuffer(signingInput),
        ),
      }],
    });
    const verifier = createTransactionGrantVerifierV1({
      clock: { now: () => new Date(requiredString(body.now)) },
      verificationKeyNamespace: keyNamespace,
      maximumGrantLifetimeMilliseconds: requiredNumber(
        body.maximumGrantLifetimeMilliseconds,
      ),
      maximumFutureIssuedAtSkewMilliseconds: requiredNumber(
        body.maximumFutureIssuedAtSkewMilliseconds,
      ),
    });
    requireLiteral(pins.artifactRuntime, "dynamic-worker");
    requireLiteral(pins.functionKind, "mutation");
    requireLiteral(pins.validatedArgsValueCodecVersion, 1);
    const verified = await verifier.verify({
      jws: body.jws,
      expectedPins: {
        deploymentId,
        scopeId: ReplacementScopeIdV1Schema.make(
          requiredString(pins.scopeId),
        ),
        packageId: TransactionPackageIdV1Schema.make(
          requiredString(pins.packageId),
        ),
        artifactRuntime: "dynamic-worker",
        artifactId: TransactionArtifactIdV1Schema.make(
          requiredString(pins.artifactId),
        ),
        sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
          requiredString(pins.sourcePackageHash),
        ),
        executionModule: TransactionExecutionModuleV1Schema.make(
          requiredString(pins.executionModule),
        ),
        functionPath: TransactionFunctionPathV1Schema.make(
          requiredString(pins.functionPath),
        ),
        functionKind: "mutation",
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          requiredString(pins.schemaVersionId),
        ),
        validatedArgsValueCodecVersion:
          FlarexValueCodecVersionSchema.make(1),
        validatedArgsSha256:
          TransactionGrantValidatedArgsSha256HexV1Schema.make(
            requiredString(pins.validatedArgsSha256),
          ),
        requestKey: TransactionRequestKeyV1Schema.make(
          requiredString(pins.requestKey),
        ),
        requestSha256: TransactionGrantRequestSha256HexV1Schema.make(
          requiredString(pins.requestSha256),
        ),
        authorizationRevocationEpoch:
          TransactionAuthorizationRevocationEpochSchema.make(
            BigInt(requiredString(pins.authorizationRevocationEpoch)),
          ),
      },
    });
    const inspection = inspectVerifiedTransactionGrantV1(verified);
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
    copyToArrayBuffer(decodeBase64(TEST_PUBLIC_KEY_SPKI_BASE64)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error("Expected an object.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function copyToArrayBuffer(bytesValue: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytesValue.byteLength);
  copy.set(bytesValue);
  return copy.buffer;
}
