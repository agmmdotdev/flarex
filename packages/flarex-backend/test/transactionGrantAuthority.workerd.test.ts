/// <reference types="node" />

import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

import {
  TransactionGrantIssuerSourceV1Error,
  makePointMutationTransactionGrantIssuerV1,
  type HostPreparedPointMutationGrantFactsV1,
} from "../src/transactionGrantIssuer";
import type { ResolvedBearerAuthentication } from "../src/authJwt";

const TEST_PRIVATE_KEY_PKCS8_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEICpBSuNq0N9DHmrl/kDt7u4bsHa9Um6KjyBQ98WSfc+J";
const NOW = new Date("2026-07-14T10:00:30.000Z");
const ISSUED_AT = new Date("2026-07-14T10:00:00.000Z");
const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2b",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-current");

describe("transaction-grant authority in workerd", () => {
  it("runs the actual executor verifier leaf in both compatibility modes", async () => {
    const privateKey = await importPrivateKey();
    const facts = preparedFacts();
    const issuer = await Effect.runPromise(
      makePointMutationTransactionGrantIssuerV1({
        maximumGrantLifetimeMilliseconds: 60_000,
        runtime: {
          currentTimeMillis: Effect.succeed(ISSUED_AT.getTime()),
          loadCurrentAuthConfig: () => Effect.succeed(null),
          nextGrantId: Effect.succeed(
            TransactionAuthorizationGrantIdV1Schema.make(
              "grant_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
            ),
          ),
          loadSigningKeyring: () => Effect.succeed({
            deploymentId: DEPLOYMENT_ID,
            keys: [{
              state: "activeSigner",
              kid: KEY_ID,
              purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
              issuedAtInclusiveEpochMilliseconds:
                ISSUED_AT.getTime() - 60_000,
              sign: signingInput => Effect.tryPromise({
                try: async () => new Uint8Array(await crypto.subtle.sign(
                  { name: "Ed25519" },
                  privateKey,
                  copyToArrayBuffer(signingInput),
                )),
                catch: () =>
                  new TransactionGrantIssuerSourceV1Error({
                    source: "signing",
                  }),
              }),
            }],
          }),
        },
      }),
    );
    const authentication: ResolvedBearerAuthentication = {
      kind: "anonymous",
      executionIdentity: { kind: "anonymous" },
    };
    const evidence = await Effect.runPromise(issuer.issue({
      authentication,
      facts,
    }));
    const workerSource = await bundleAuthorityWorker();

    for (const compatibilityFlags of [
      undefined,
      ["nodejs_compat"] as const,
    ]) {
      const worker = new Miniflare({
        modules: [{
          type: "ESModule",
          path: "worker.js",
          contents: workerSource,
        }],
        compatibilityDate: "2026-06-14",
        ...(compatibilityFlags === undefined
          ? {}
          : { compatibilityFlags: [...compatibilityFlags] }),
      });
      try {
        const response = await worker.dispatchFetch(
          "https://grant-authority.test/",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jws: evidence.jws,
              keyId: KEY_ID,
              keyIssuedAtInclusiveEpochMilliseconds:
                ISSUED_AT.getTime() - 60_000,
              now: NOW.toISOString(),
              maximumGrantLifetimeMilliseconds: 60_000,
              maximumFutureIssuedAtSkewMilliseconds: 0,
              expectedPins: {
                deploymentId: evidence.payload.deploymentId,
                scopeId: evidence.payload.scopeId,
                packageId: evidence.payload.packageId,
                artifactRuntime: evidence.payload.artifactRuntime,
                artifactId: evidence.payload.artifactId,
                sourcePackageHash: evidence.payload.sourcePackageHash,
                executionModule: evidence.payload.executionModule,
                functionPath: evidence.payload.functionPath,
                functionKind: evidence.payload.functionKind,
                schemaVersionId: evidence.payload.schemaVersionId,
                validatedArgsValueCodecVersion:
                  evidence.payload.validatedArgsValueCodecVersion,
                validatedArgsSha256: evidence.payload.validatedArgsSha256,
                requestKey: evidence.payload.requestKey,
                requestSha256: evidence.payload.requestSha256,
                authorizationRevocationEpoch:
                  evidence.payload.authorizationRevocationEpoch.toString(),
              },
            }),
          },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          grantId: evidence.payload.grantId,
          keyId: KEY_ID,
          authKind: "anonymous",
          authorizationRevocationEpoch: "7",
          verifiedAt: NOW.toISOString(),
        });
      } finally {
        await worker.dispose();
      }
    }
  });
});

async function bundleAuthorityWorker(): Promise<string> {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(testDirectory, "transactionGrantAuthority.worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(
    chunk => chunk.type === "chunk" && chunk.fileName === "worker.js",
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Transaction-grant authority Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-a2b-workspace-package-resolution",
    resolveId(id) {
      if (
        id === "@flarex/executor/transaction-grant" ||
        id === "flarex-protocol" ||
        id.startsWith("flarex-protocol/")
      ) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}

function preparedFacts(): HostPreparedPointMutationGrantFactsV1 {
  return {
    deploymentId: DEPLOYMENT_ID,
    scopeId: ReplacementScopeIdV1Schema.make(
      "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    ),
    packageId: TransactionPackageIdV1Schema.make("package_a2b"),
    sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
      "a".repeat(64),
    ),
    executionModule: TransactionExecutionModuleV1Schema.make(
      "flarex/orders.ts",
    ),
    functionPath: TransactionFunctionPathV1Schema.make("orders:create"),
    schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_a2b"),
    validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
      new Uint8Array(32).fill(0xbb),
    ),
    requestKey: TransactionRequestKeyV1Schema.make("request_a2b"),
    requestSha256: TransactionRequestSha256V1Schema.make(
      new Uint8Array(32).fill(0xcc),
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
  };
}

async function importPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    copyToArrayBuffer(decodeBase64(TEST_PRIVATE_KEY_PKCS8_BASE64)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function copyToArrayBuffer(bytesValue: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytesValue.byteLength);
  copy.set(bytesValue);
  return copy.buffer;
}
