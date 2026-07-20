/// <reference types="node" />

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

import {
  TransactionGrantIssuerSourceV1Error,
  makePointMutationTransactionGrantIssuerV1,
} from "../src/transactionGrantIssuer";
import {
  createServerPreparedTransactionRequestKeyV1,
  makeIssuerPointMutationGrantPreparationV1,
} from "../src/pointMutationGrantPreparation";
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
    const scopeId = ReplacementScopeIdV1Schema.make(
      "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    );
    const targetMetadata = targetMetadataFixture(scopeId);
    const currentScopeAuthority = {
      deploymentId: DEPLOYMENT_ID,
      scopeId,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(7n),
    };
    const preparation = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: () => Effect.succeed(targetMetadata),
      loadCurrentScopeAuthority: () =>
        Effect.succeed(currentScopeAuthority),
    });
    const preparedStart = await runTestEffect(preparation.prepare({
      deploymentId: DEPLOYMENT_ID,
      functionPath: TransactionFunctionPathV1Schema.make("orders:create"),
      args: { orderId: "order_workerd" },
      requestKey: createServerPreparedTransactionRequestKeyV1(
        TransactionRequestKeyV1Schema.make("request_a2c_workerd"),
      ),
    }));
    const issuer = makePointMutationTransactionGrantIssuerV1({
      grantRetentionPolicy: Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 60_000,
          maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 60_000,
        }),
      ),
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
                copyBytesToArrayBuffer(signingInput),
              )),
              catch: () =>
                new TransactionGrantIssuerSourceV1Error({
                  source: "signing",
                }),
            }),
          }],
        }),
      },
    });
    const authentication: ResolvedBearerAuthentication = {
      kind: "anonymous",
      executionIdentity: { kind: "anonymous" },
    };
    const evidence = await runTestEffect(issuer.issue({
      authentication,
      preparedStart,
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
              // Deliberately conflicting request data: executor authority is
              // frozen in Worker setup and must not be caller-selectable.
              targetMetadata: { format: "caller-authored" },
              currentScopeAuthority: {
                deploymentId: "deployment_caller_authored",
                scopeId: "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874",
                authorizationRevocationEpoch: "999",
              },
              candidate: {
                deploymentId: DEPLOYMENT_ID,
                functionPath: "orders:create",
                args: { orderId: "order_workerd" },
                requestKey: "request_a2c_workerd",
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
        id === "@flarex/executor/point-mutation-start" ||
        id === "flarex-protocol" ||
        id.startsWith("flarex-protocol/")
      ) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}

function targetMetadataFixture(
  scopeId: ReplacementScopeIdV1,
) {
  return {
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    scopeId,
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
  };
}

async function importPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    copyBytesToArrayBuffer(decodeBase64(TEST_PRIVATE_KEY_PKCS8_BASE64)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

function runTestEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
