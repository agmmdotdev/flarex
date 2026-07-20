import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import type {
  AuthConfig,
  CustomJwtAuthProvider,
} from "flarex-protocol/auth";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  TransactionGrantIssuanceV1Error,
  TransactionGrantIssuerSourceV1Error,
  makePointMutationTransactionGrantIssuerV1,
  type ActiveTransactionGrantSigningKeyV1,
  type PointMutationTransactionGrantIssuerV1,
  type TransactionGrantIssuerRuntimeV1,
  type TransactionGrantSigningKeyV1,
} from "../src/transactionGrantIssuer";
import {
  createServerPreparedTransactionRequestKeyV1,
  inspectIssuerPreparedPointMutationStartV1,
  makeIssuerPointMutationGrantPreparationV1,
  type IssuerPreparedPointMutationStartV1,
} from "../src/pointMutationGrantPreparation";
import {
  verifyBearerTokenToAuthenticationEffect,
  type ResolvedBearerAuthentication,
} from "../src/authJwt";
import { createRsaSigningKeys, dataJsonUrl, signJwt } from "./authFixtures";

const TEST_PRIVATE_KEY_PKCS8_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEICpBSuNq0N9DHmrl/kDt7u4bsHa9Um6KjyBQ98WSfc+J";
const NOW = new Date("2026-07-14T10:00:00.000Z");
const NOW_MILLISECONDS = NOW.getTime();
const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2b",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-current");
const OTHER_KEY_ID = TransactionGrantKeyIdV1Schema.make(
  "grant-key-a2b-other",
);
const GRANT_ID = TransactionAuthorizationGrantIdV1Schema.make(
  "grant_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);

describe("point-mutation transaction-grant issuer", () => {
  it("derives every authority field for anonymous execution", async () => {
    const { issuer, getSigningCalls } = await issuerFixture({
      authentication: anonymousAuthentication(),
      currentAuthConfig: null,
    });

    const preparedStart = await preparedStartFixture();
    const evidence = await runTestEffect(issuer.issue({
      authentication: anonymousAuthentication(),
      preparedStart,
    }));

    expect(getSigningCalls()).toBe(1);
    expect(evidence.protectedHeader.kid).toBe(KEY_ID);
    expect(evidence.payload).toMatchObject({
      format: "flarex.transaction-grant",
      version: 1,
      grantId: GRANT_ID,
      deploymentId: DEPLOYMENT_ID,
      artifactRuntime: "dynamic-worker",
      artifactId: `artifact_${"a".repeat(32)}`,
      functionKind: "mutation",
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      auth: { kind: "anonymous" },
      issuedAt: "2026-07-14T10:00:00.000Z",
      expiresAt: "2026-07-14T10:02:00.000Z",
      validatedArgsValueCodecVersion: 1,
    });
    const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: evidence.payload.auth,
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    expect(evidence.payload.identityAccessPolicySha256).toBe(
      policy.sha256Hex,
    );
    const prepared = inspectIssuerPreparedPointMutationStartV1(preparedStart);
    expect(evidence.payload.validatedArgsSha256).toBe(
      prepared.logicalPins.validatedArgsSha256,
    );
    expect(evidence.payload.requestSha256).toBe(
      prepared.logicalPins.requestSha256,
    );
  });

  it("rechecks exact provider membership at any current array index and caps expiry", async () => {
    const verified = await verifiedAuthenticationFixture();
    const movedConfig: AuthConfig = {
      providers: [
        verified.matchedProvider,
        {
          domain: "https://unrelated.example.com",
          applicationID: "unrelated",
        },
      ],
    };
    const { issuer } = await issuerFixture({
      authentication: verified.authentication,
      currentAuthConfig: movedConfig,
      maximumGrantLifetimeMilliseconds: 120_000,
    });

    const evidence = await runTestEffect(issuer.issue({
      authentication: verified.authentication,
      preparedStart: await preparedStartFixture(),
    }));

    expect(evidence.payload.expiresAt).toBe(
      "2026-07-14T10:00:37.000Z",
    );
    expect(evidence.payload.auth).toEqual({
      kind: "verifiedBearer",
      issuer: "https://issuer.example.com",
      subject: "user_a2b",
      claims: {},
    });
    expect(evidence.payload.auth).not.toHaveProperty("role");
  });

  it("uses grant lifetime rather than the live-snapshot retention budget", async () => {
    const preparedStart = await preparedStartFixture();
    const issuedPayloads = [];
    for (const maximumLiveSnapshotRetentionMilliseconds of [
      15_000,
      100_000,
    ]) {
      const { issuer } = await issuerFixture({
        authentication: anonymousAuthentication(),
        currentAuthConfig: null,
        maximumGrantLifetimeMilliseconds: 10_000,
        maximumFutureIssuedAtSkewMilliseconds: 5_000,
        maximumLiveSnapshotRetentionMilliseconds,
      });
      const evidence = await runTestEffect(issuer.issue({
        authentication: anonymousAuthentication(),
        preparedStart,
      }));

      expect(evidence.payload.expiresAt).toBe(
        "2026-07-14T10:00:10.000Z",
      );
      issuedPayloads.push(evidence.payload);
    }

    expect(issuedPayloads[1]).toEqual(issuedPayloads[0]);
  });

  it("rejects provider removal, changed configuration, and exact credential expiry", async () => {
    const verified = await verifiedAuthenticationFixture();
    const changedProvider: CustomJwtAuthProvider = {
      ...verified.matchedProvider,
      algorithm: "ES256",
    };
    const changedConfig: AuthConfig = {
      providers: [changedProvider],
    };

    for (const currentAuthConfig of [
      { providers: [] },
      changedConfig,
    ] satisfies ReadonlyArray<AuthConfig>) {
      const { issuer } = await issuerFixture({
        authentication: verified.authentication,
        currentAuthConfig,
      });
      await expect(runTestEffect(issuer.issue({
        authentication: verified.authentication,
        preparedStart: await preparedStartFixture(),
      }))).rejects.toMatchObject({
        _tag: "TransactionGrantIssuanceV1Error",
        issue: "authProviderInactive",
      });
    }

    const expired = await verifiedAuthenticationFixture(
      Math.floor(NOW_MILLISECONDS / 1_000),
    );
    const { issuer } = await issuerFixture({
      authentication: expired.authentication,
      currentAuthConfig: { providers: [expired.matchedProvider] },
    });
    await expect(runTestEffect(issuer.issue({
      authentication: expired.authentication,
      preparedStart: await preparedStartFixture(),
    }))).rejects.toMatchObject({
      _tag: "TransactionGrantIssuanceV1Error",
      issue: "credentialExpired",
    });
  });

  it("enforces one active signer, purpose, windows, IDs, and retention capping", async () => {
    const active = await activeSigningKey();
    const invalidCases: ReadonlyArray<{
      readonly keys: ReadonlyArray<TransactionGrantSigningKeyV1>;
      readonly issue: TransactionGrantIssuanceV1Error["issue"];
    }> = [
      { keys: [], issue: "noActiveSigner" },
      { keys: [active, { ...active, kid: OTHER_KEY_ID }], issue: "multipleActiveSigners" },
      { keys: [{ ...active, purpose: "artifact-signing" }], issue: "wrongKeyPurpose" },
      { keys: [active, { ...active, state: "verifyOnly" }], issue: "duplicateKeyId" },
      {
        keys: [{
          ...active,
          issuedAtInclusiveEpochMilliseconds: NOW_MILLISECONDS + 1,
        }],
        issue: "activeSignerOutOfWindow",
      },
    ];

    for (const invalidCase of invalidCases) {
      const { issuer } = await issuerFixture({
        authentication: anonymousAuthentication(),
        currentAuthConfig: null,
        keys: invalidCase.keys,
      });
      await expect(runTestEffect(issuer.issue({
        authentication: anonymousAuthentication(),
        preparedStart: await preparedStartFixture(),
      }))).rejects.toMatchObject({
        _tag: "TransactionGrantIssuanceV1Error",
        issue: invalidCase.issue,
      });
    }

    const { issuer } = await issuerFixture({
      authentication: anonymousAuthentication(),
      currentAuthConfig: null,
      maximumGrantLifetimeMilliseconds: 120_000,
      keys: [{
        ...active,
        verificationEndsAtExclusiveEpochMilliseconds:
          NOW_MILLISECONDS + 29_000,
      }],
    });
    const evidence = await runTestEffect(issuer.issue({
      authentication: anonymousAuthentication(),
      preparedStart: await preparedStartFixture(),
    }));
    expect(evidence.payload.expiresAt).toBe(
      "2026-07-14T10:00:29.000Z",
    );
  });

  it("projects only the validated policy lifetime and exposes no caller authority fields", () => {
    expectTypeOf<ReturnType<
      typeof makePointMutationTransactionGrantIssuerV1
    >>().toEqualTypeOf<PointMutationTransactionGrantIssuerV1>();
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("policyVersion");
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("capabilities");
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("identityAccessPolicySha256");
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("grantId");
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("issuedAt");
    expectTypeOf<IssuerPreparedPointMutationStartV1>()
      .not.toHaveProperty("kid");
  });
});

async function issuerFixture(input: {
  readonly authentication: ResolvedBearerAuthentication;
  readonly currentAuthConfig: unknown | null;
  readonly maximumGrantLifetimeMilliseconds?: number;
  readonly maximumFutureIssuedAtSkewMilliseconds?: number;
  readonly maximumLiveSnapshotRetentionMilliseconds?: number;
  readonly keys?: ReadonlyArray<TransactionGrantSigningKeyV1>;
}): Promise<{
  readonly issuer: PointMutationTransactionGrantIssuerV1;
  readonly getSigningCalls: () => number;
}> {
  let signingCalls = 0;
  const baseKey = await activeSigningKey(() => {
    signingCalls += 1;
  });
  const runtime = await issuerRuntime({
    currentAuthConfig: input.currentAuthConfig,
    keys: input.keys ?? [baseKey],
  });
  const maximumGrantLifetimeMilliseconds =
    input.maximumGrantLifetimeMilliseconds ?? 120_000;
  const issuer = makePointMutationTransactionGrantIssuerV1({
    grantRetentionPolicy: Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds,
        maximumFutureIssuedAtSkewMilliseconds:
          input.maximumFutureIssuedAtSkewMilliseconds ?? 0,
        maximumLiveSnapshotRetentionMilliseconds:
          input.maximumLiveSnapshotRetentionMilliseconds ??
          maximumGrantLifetimeMilliseconds,
      }),
    ),
    runtime,
  });
  return {
    issuer,
    getSigningCalls: () => signingCalls,
  };
}

async function issuerRuntime(input: {
  readonly currentAuthConfig: unknown | null;
  readonly keys: ReadonlyArray<TransactionGrantSigningKeyV1>;
}): Promise<TransactionGrantIssuerRuntimeV1> {
  return {
    currentTimeMillis: Effect.succeed(NOW_MILLISECONDS),
    loadCurrentAuthConfig: () => Effect.succeed(input.currentAuthConfig),
    nextGrantId: Effect.succeed(GRANT_ID),
    loadSigningKeyring: () => Effect.succeed({
      deploymentId: DEPLOYMENT_ID,
      keys: input.keys,
    }),
  };
}

async function activeSigningKey(
  onSign: () => void = () => undefined,
): Promise<ActiveTransactionGrantSigningKeyV1> {
  const privateKey = await importPrivateKey();
  return {
    state: "activeSigner",
    kid: KEY_ID,
    purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
    issuedAtInclusiveEpochMilliseconds: NOW_MILLISECONDS - 60_000,
    sign: signingInput => Effect.tryPromise({
      try: async () => {
        onSign();
        return new Uint8Array(await crypto.subtle.sign(
          { name: "Ed25519" },
          privateKey,
          copyBytesToArrayBuffer(signingInput),
        ));
      },
      catch: () =>
        new TransactionGrantIssuerSourceV1Error({ source: "signing" }),
    }),
  };
}

async function preparedStartFixture(): Promise<
  IssuerPreparedPointMutationStartV1
> {
  const scopeId = ReplacementScopeIdV1Schema.make(
    "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
  );
  const preparation = makeIssuerPointMutationGrantPreparationV1({
    loadActiveTargetMetadata: () => Effect.succeed({
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
    }),
    loadCurrentScopeAuthority: () => Effect.succeed({
      deploymentId: DEPLOYMENT_ID,
      scopeId,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(7n),
    }),
  });
  return runTestEffect(preparation.prepare({
    deploymentId: DEPLOYMENT_ID,
    functionPath: TransactionFunctionPathV1Schema.make("orders:create"),
    args: { orderId: "order_a2b" },
    requestKey: createServerPreparedTransactionRequestKeyV1(
      TransactionRequestKeyV1Schema.make("request_a2b"),
    ),
  }));
}

function anonymousAuthentication(): ResolvedBearerAuthentication {
  return {
    kind: "anonymous",
    executionIdentity: { kind: "anonymous" },
  };
}

async function verifiedAuthenticationFixture(
  expiresAtEpochSeconds = Math.floor(NOW_MILLISECONDS / 1_000) + 37,
): Promise<{
  readonly authentication: Extract<
    ResolvedBearerAuthentication,
    { readonly kind: "verifiedBearer" }
  >;
  readonly matchedProvider: Extract<
    AuthConfig["providers"][number],
    { readonly type: "customJwt" }
  >;
}> {
  const keys = await createRsaSigningKeys("a2b-rs256");
  const matchedProvider = {
    type: "customJwt",
    issuer: "https://issuer.example.com",
    jwks: dataJsonUrl({ keys: [keys.jwk] }),
    algorithm: "RS256",
    applicationID: "flarex-app",
  } as const;
  const authConfig: AuthConfig = {
    providers: [
      {
        domain: "https://unrelated.example.com",
        applicationID: "unrelated",
      },
      matchedProvider,
    ],
  };
  const token = await signJwt({
    privateKey: keys.privateKey,
    kid: keys.jwk.kid,
    payload: {
      iss: matchedProvider.issuer,
      sub: "user_a2b",
      aud: matchedProvider.applicationID,
      exp: expiresAtEpochSeconds,
      role: "admin",
      team: "billing",
    },
  });
  const authentication = await runTestEffect(
    verifyBearerTokenToAuthenticationEffect({
      token,
      authConfig,
      now: NOW,
    }),
  );
  return { authentication, matchedProvider };
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
