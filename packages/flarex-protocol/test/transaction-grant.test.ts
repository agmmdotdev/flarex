/// <reference types="node" />

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Miniflare } from "miniflare";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as protocolRoot from "../src/index";
import * as transactionGrantProtocol from "../src/transaction-grant";
import {
  MAX_TRANSACTION_GRANT_CANONICAL_BYTES_V1,
  MAX_TRANSACTION_GRANT_CLAIM_FIELDS_V1,
  MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1,
  MAX_TRANSACTION_GRANT_KEY_ID_UTF8_BYTES_V1,
  MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1,
  MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
  MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1,
  TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantIdentityAccessPolicySha256HexV1Schema,
  TransactionGrantProtocolV1Error,
  TransactionGrantRequestSha256HexV1Schema,
  TransactionGrantValidatedArgsSha256HexV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  createTransactionGrantSigningInputV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  transactionGrantIdentityAccessPolicySha256HexV1FromBytes,
  transactionGrantRequestSha256BytesV1FromHex,
  transactionGrantRequestSha256HexV1FromBytes,
  transactionGrantValidatedArgsSha256BytesV1FromHex,
  transactionGrantValidatedArgsSha256HexV1FromBytes,
  type CanonicalTransactionGrantPayloadBase64UrlV1,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantIdentityAccessPolicySha256HexV1,
  type TransactionGrantJwsV1,
  type TransactionGrantProtectedHeaderBase64UrlV1,
  type TransactionGrantRequestSha256HexV1,
  type TransactionGrantValidatedArgsSha256HexV1,
  type UnverifiedTransactionGrantPayloadBase64UrlV1,
} from "../src/transaction-grant";
import {
  TransactionArgumentsSha256V1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
} from "../src/transaction-session";
import { canonicalizeFlarexValueV1 } from "../src/value";

const TEST_PRIVATE_KEY_PKCS8_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEICpBSuNq0N9DHmrl/kDt7u4bsHa9Um6KjyBQ98WSfc+J";
const TEST_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAno+3aYSLpdF45q6y9wrLdVOEWJLjvbGTDmfTVRqLEZ8=";

const GOLDEN_HEADER_BASE64URL =
  "eyJhbGciOiJFZDI1NTE5Iiwia2lkIjoiZ3JhbnQta2V5LTIwMjYtMDciLCJ0eXAiOiJmbGFyZXgtdHJhbnNhY3Rpb24tZ3JhbnQrandzIn0";
const GOLDEN_PAYLOAD_SHA256 =
  "fec257533571f1c591e3b5b54d915dc8fd9e185dd9b42d75ba6bb3be5aa6abd8";
const GOLDEN_SIGNING_INPUT_SHA256 =
  "ae55c55e6e8ad0e9877f0cf583ddcd1387d6f358e60c0b9679d364a757f06737";
const GOLDEN_SIGNATURE_BASE64URL =
  "CGaidZNxjDOsQRGo_g_W2gvQTLyoYKGp5UCvUg1kku6qHsLXtJqklMZBNIy4dTx2O6T1ZQovhq0iLCdDl6QHAA";
const GOLDEN_ENVELOPE_SHA256 =
  "fc987a6c5fa54539d08ee4ec417912d7e972e7d6ca134dcd21845b4baa202330";

const ED25519_WORKER_SOURCE = `
const decodeBase64 = value =>
  Uint8Array.from(atob(value), character => character.charCodeAt(0));
const decodeBase64Url = value => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return decodeBase64(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
};
const encodeBase64Url = bytes => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\\+/g, "-")
    .replace(/\\//g, "_")
    .replace(/=+$/u, "");
};
export default {
  async fetch(request) {
    const input = await request.json();
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      decodeBase64(input.privateKeyPkcs8Base64),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const publicKey = await crypto.subtle.importKey(
      "spki",
      decodeBase64(input.publicKeySpkiBase64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signingInput = decodeBase64Url(input.signingInputBase64Url);
    const suppliedSignature = decodeBase64Url(input.signatureBase64Url);
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      signingInput,
    ));
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      suppliedSignature,
      signingInput,
    );
    return Response.json({
      signatureBase64Url: encodeBase64Url(signature),
      verified,
    });
  },
};
`;

describe("transaction-grant protocol", () => {
  it("pins domain-separated point-mutation policy evidence", async () => {
    const anonymous = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      auth: { kind: "anonymous" },
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    });
    const reorderedInput =
      await canonicalizeTransactionGrantIdentityAccessPolicyV1({
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        auth: { kind: "anonymous" },
        capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      });
    const bearer = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: {
        kind: "verifiedBearer",
        issuer: "https://identity.example.test",
        subject: "user_a2b",
        claims: {},
      },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });

    expect(anonymous.sha256Hex).toBe(
      "613ed554d05f8b07b6b1e848a35bd99ce11eed130745baf7b0f3d082dbbdf913",
    );
    expect(anonymous.canonicalBytes).toHaveLength(255);
    expect(new TextDecoder().decode(anonymous.canonicalBytes)).toBe(
      '{"format":"flarex-value","value":{"auth":{"kind":"anonymous"},"capabilities":["db:get","db:insert","db:patch","db:replace","db:delete"],"format":"flarex.identity-access-policy","policyVersion":"policy_point_mutation_v1","version":1},"valueCodecVersion":1}',
    );
    expect(reorderedInput.sha256Hex).toBe(anonymous.sha256Hex);
    expect(reorderedInput.canonicalBytes).toEqual(anonymous.canonicalBytes);
    expect(bearer.sha256Hex).not.toBe(anonymous.sha256Hex);
    expect(anonymous.policy).toEqual({
      format: "flarex.identity-access-policy",
      version: 1,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    expect(Object.isFrozen(anonymous.policy)).toBe(true);
    expect(Object.isFrozen(anonymous.policy.capabilities)).toBe(true);
    const detachedBytes = anonymous.canonicalBytes;
    detachedBytes.fill(0);
    expect(anonymous.sha256Hex).toBe(
      "613ed554d05f8b07b6b1e848a35bd99ce11eed130745baf7b0f3d082dbbdf913",
    );
    expect(anonymous.canonicalBytes[0]).not.toBe(0);
  });

  it("pins deterministic Ed25519 JWS and S07 evidence golden values", async () => {
    const fixture = await signedFixture();

    expect(fixture.header.canonicalText).toBe(
      '{"alg":"Ed25519","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws"}',
    );
    expect(fixture.header.base64url).toBe(GOLDEN_HEADER_BASE64URL);
    expect(fixture.payload.canonicalBytes).toHaveLength(1_303);
    expect(await sha256Hex(fixture.payload.canonicalBytes)).toBe(
      GOLDEN_PAYLOAD_SHA256,
    );
    expect(fixture.signingInput).toHaveLength(1_846);
    expect(await sha256Hex(fixture.signingInput)).toBe(
      GOLDEN_SIGNING_INPUT_SHA256,
    );
    expect(fixture.jws.signature).toBe(GOLDEN_SIGNATURE_BASE64URL);
    expect(fixture.evidence.signatureBytes).toHaveLength(64);
    expect(fixture.evidence.authorizationGrantCanonicalBytes).toHaveLength(
      2_031,
    );
    expect(toHex(fixture.evidence.authorizationGrantSha256)).toBe(
      GOLDEN_ENVELOPE_SHA256,
    );
    expect(await verifyEvidence(fixture.evidence)).toBe(true);
  });

  it("reproduces the golden signature in pinned workerd WebCrypto", async () => {
    const fixture = await signedFixture();
    for (const compatibilityFlags of [
      undefined,
      ["nodejs_compat"] as const,
    ]) {
      const worker = new Miniflare({
        modules: [{
          type: "ESModule",
          path: "worker.js",
          contents: ED25519_WORKER_SOURCE,
        }],
        compatibilityDate: "2026-06-14",
        ...(compatibilityFlags === undefined
          ? {}
          : { compatibilityFlags: [...compatibilityFlags] }),
      });
      try {
        const response = await worker.dispatchFetch("https://grant.test/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            privateKeyPkcs8Base64: TEST_PRIVATE_KEY_PKCS8_BASE64,
            publicKeySpkiBase64: TEST_PUBLIC_KEY_SPKI_BASE64,
            signingInputBase64Url: base64UrlFromBytes(fixture.signingInput),
            signatureBase64Url: fixture.jws.signature,
          }),
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          signatureBase64Url: GOLDEN_SIGNATURE_BASE64URL,
          verified: true,
        });
      } finally {
        await worker.dispose();
      }
    }
  });

  it("projects exact branded S07 evidence without creating authority", async () => {
    const fixture = await signedFixture();
    const repeated = await deriveInertTransactionGrantEvidenceV1(fixture.jws);

    expect(repeated.authorizationGrantId).toBe(
      "grant_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    );
    expect(repeated.authorizationGrantExpiresAt).toBe(
      "2026-07-14T10:05:00.000Z",
    );
    expect(repeated.authorizationRevocationEpoch).toBe(7n);
    expect(repeated.authorizationGrantValueCodecVersion).toBe(1);
    expect(repeated.authorizationGrantJson).toEqual(fixture.jws);
    expect(repeated.authorizationGrantCanonicalBytes).toEqual(
      fixture.evidence.authorizationGrantCanonicalBytes,
    );
    expect(repeated.authorizationGrantSha256).toEqual(
      fixture.evidence.authorizationGrantSha256,
    );
    expect(repeated).not.toHaveProperty("verified");
    expect(repeated).not.toHaveProperty("authorize");
    expect(protocolRoot).not.toHaveProperty("TransactionGrantJwsV1Schema");
    expect(protocolRoot).not.toHaveProperty("TransactionGrantJwsWireV1Schema");
    expect(transactionGrantProtocol).toHaveProperty(
      "TransactionGrantJwsWireV1Schema",
    );
    expect(transactionGrantProtocol).not.toHaveProperty(
      "TransactionGrantJwsV1Schema",
    );
    expect(transactionGrantProtocol).not.toHaveProperty(
      "CanonicalTransactionGrantPayloadBase64UrlV1Schema",
    );

    expectTypeOf(repeated).toEqualTypeOf<InertTransactionGrantEvidenceV1>();
    expectTypeOf<string>()
      .not.toMatchTypeOf<TransactionGrantProtectedHeaderBase64UrlV1>();
    expectTypeOf<string>()
      .not.toMatchTypeOf<CanonicalTransactionGrantPayloadBase64UrlV1>();
    expectTypeOf<UnverifiedTransactionGrantPayloadBase64UrlV1>()
      .not.toMatchTypeOf<CanonicalTransactionGrantPayloadBase64UrlV1>();
    expectTypeOf<Record<string, unknown>>()
      .not.toMatchTypeOf<TransactionGrantJwsV1>();
  });

  it("keeps every redundant evidence projection immutable and copy-on-read", async () => {
    const fixture = await signedFixture();
    const evidence = fixture.evidence;

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.jws)).toBe(true);
    expect(Object.isFrozen(evidence.payload)).toBe(true);
    expect(Object.isFrozen(evidence.payload.capabilities)).toBe(true);
    expect(Object.isFrozen(evidence.payload.auth)).toBe(true);
    expect(Object.isFrozen(evidence.authorizationGrantJson)).toBe(true);
    expect(Reflect.set(evidence.jws, "signature", "forged")).toBe(false);
    expect(Reflect.set(
      evidence.payload.capabilities,
      "0",
      "db:delete",
    )).toBe(false);

    if (evidence.payload.auth.kind !== "verifiedBearer") {
      throw new Error("Expected verified-bearer fixture auth.");
    }
    expect(Object.isFrozen(evidence.payload.auth.claims)).toBe(true);
    expect(Reflect.set(
      evidence.payload.auth.claims,
      "role",
      "admin",
    )).toBe(false);
    const teams = evidence.payload.auth.claims.teams;
    if (!Array.isArray(teams)) {
      throw new Error("Expected fixture teams array.");
    }
    expect(Object.isFrozen(teams)).toBe(true);
    expect(Reflect.set(teams, "0", "administrators")).toBe(false);

    const signatureBytes = evidence.signatureBytes;
    const signingInput = evidence.signingInput;
    const canonicalBytes = evidence.authorizationGrantCanonicalBytes;
    const sha256 = evidence.authorizationGrantSha256;
    signatureBytes.fill(0);
    signingInput.fill(0);
    canonicalBytes.fill(0);
    sha256.fill(0);

    expect(evidence.signatureBytes).not.toEqual(signatureBytes);
    expect(evidence.signingInput).not.toEqual(signingInput);
    expect(evidence.authorizationGrantCanonicalBytes).not.toEqual(
      canonicalBytes,
    );
    expect(evidence.authorizationGrantSha256).not.toEqual(sha256);
    expect(await verifyEvidence(evidence)).toBe(true);
  });

  it("freezes a detached payload without mutating caller-owned claims", async () => {
    const teams = ["catalog"];
    const claims = { role: "editor", teams };
    const input = fixturePayload({
      auth: {
        kind: "verifiedBearer",
        issuer: "https://identity.example.test",
        subject: "user_123",
        claims,
      },
    });
    const canonical = await canonicalizeTransactionGrantPayloadV1(input);

    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(claims)).toBe(false);
    expect(Object.isFrozen(teams)).toBe(false);
    expect(Object.isFrozen(canonical.payload)).toBe(true);
    if (canonical.payload.auth.kind !== "verifiedBearer") {
      throw new Error("Expected verified-bearer fixture auth.");
    }
    expect(Object.isFrozen(canonical.payload.auth.claims)).toBe(true);
    expect(Object.isFrozen(canonical.payload.auth.claims.teams)).toBe(true);

    claims.role = "admin";
    teams.push("administrators");
    expect(canonical.payload.auth.claims).toEqual({
      role: "editor",
      teams: ["catalog"],
    });
  });

  it("canonicalizes payload and envelope independently of insertion order", async () => {
    const firstInput = fixturePayload();
    const secondInput = Object.fromEntries(
      Object.entries(fixturePayload()).reverse(),
    );
    secondInput.auth = {
      kind: "verifiedBearer",
      subject: "user_123",
      issuer: "https://identity.example.test",
      claims: { teams: ["catalog"], role: "editor" },
    };

    const first = await canonicalizeTransactionGrantPayloadV1(firstInput);
    const second = await canonicalizeTransactionGrantPayloadV1(secondInput);

    expect(second.canonicalBytes).toEqual(first.canonicalBytes);
    expect(second.base64url).toBe(first.base64url);
    expect(await sha256Hex(second.canonicalBytes)).toBe(
      GOLDEN_PAYLOAD_SHA256,
    );

    const fixture = await signedFixture();
    const reversedWireJws = Object.fromEntries(
      Object.entries(fixture.jws).reverse(),
    );
    const reversedEvidence = await deriveInertTransactionGrantEvidenceV1(
      reversedWireJws,
    );
    expect(reversedEvidence.authorizationGrantCanonicalBytes).toEqual(
      fixture.evidence.authorizationGrantCanonicalBytes,
    );
    expect(reversedEvidence.authorizationGrantSha256).toEqual(
      fixture.evidence.authorizationGrantSha256,
    );
  });

  it("rejects every unsupported or noncanonical JWS shape", async () => {
    const fixture = await signedFixture();
    const unsupportedShapes: ReadonlyArray<unknown> = [
      `${fixture.jws.protected}.${fixture.jws.payload}.${fixture.jws.signature}`,
      { payload: fixture.jws.payload, signatures: [] },
      { ...fixture.jws, header: { kid: "unprotected" } },
      { ...fixture.jws, signatures: [{ signature: fixture.jws.signature }] },
      { protected: fixture.jws.protected, payload: fixture.jws.payload },
      { ...fixture.jws, signature: `${fixture.jws.signature}=` },
      { ...fixture.jws, payload: `${fixture.jws.payload}=` },
      { ...fixture.jws, extra: true },
    ];
    for (const invalid of unsupportedShapes) {
      await expect(deriveInertTransactionGrantEvidenceV1(invalid))
        .rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    }

    const noncanonicalOrUnsupportedHeaders = [
      '{"typ":"flarex-transaction-grant+jws","kid":"grant-key-2026-07","alg":"Ed25519"}',
      '{"alg":"EdDSA","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws"}',
      '{"alg":"RS256","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws"}',
      '{"alg":"Ed25519","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws","crit":[]}',
      '{"alg":"Ed25519","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws","b64":false}',
      '{"alg":"Ed25519","alg":"Ed25519","kid":"grant-key-2026-07","typ":"flarex-transaction-grant+jws"}',
    ];
    for (const header of noncanonicalOrUnsupportedHeaders) {
      await expect(deriveInertTransactionGrantEvidenceV1({
        ...fixture.jws,
        protected: base64UrlFromUtf8(header),
      })).rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    }

    const payloadBytesWithWhitespace = new Uint8Array(
      fixture.payload.canonicalBytes.byteLength + 1,
    );
    payloadBytesWithWhitespace.set(fixture.payload.canonicalBytes);
    payloadBytesWithWhitespace[payloadBytesWithWhitespace.length - 1] = 0x0a;
    for (const payload of [
      base64UrlFromBytes(new Uint8Array([0xff])),
      base64UrlFromUtf8("{"),
      base64UrlFromBytes(payloadBytesWithWhitespace),
    ]) {
      await expect(deriveInertTransactionGrantEvidenceV1({
        ...fixture.jws,
        payload,
      })).rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    }
  });

  it("rejects invalid payload pins, limits, capabilities, auth, time, and epoch", async () => {
    const tooManyClaims = Object.fromEntries(
      Array.from(
        { length: MAX_TRANSACTION_GRANT_CLAIM_FIELDS_V1 + 1 },
        (_, index) => [`claim_${index}`, index],
      ),
    );
    const invalidInputs: Array<Record<string, unknown>> = [
      fixturePayload({ artifactId: `artifact_${"f".repeat(32)}` }),
      fixturePayload({ capabilities: ["db:insert", "db:get"] }),
      fixturePayload({ capabilities: ["db:get", "db:get"] }),
      fixturePayload({ capabilities: ["db:write"] }),
      fixturePayload({ authorizationRevocationEpoch: "01" }),
      fixturePayload({ authorizationRevocationEpoch: "-1" }),
      fixturePayload({ issuedAt: "2026-07-14T10:00:00Z" }),
      fixturePayload({ expiresAt: "2026-07-14T10:00:00.000Z" }),
      fixturePayload({ validatedArgsValueCodecVersion: 2 }),
      fixturePayload({ grantId: "not-a-grant" }),
      fixturePayload({ deploymentId: "x".repeat(
        MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1 + 1,
      ) }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: tooManyClaims,
        },
      }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: {
            oversized: "x".repeat(
              MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1,
            ),
          },
        },
      }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: { $role: "editor" },
        },
      }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: { profile: { "display-name-é": "User" } },
        },
      }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: { malformedUnicode: "\ud800" },
        },
      }),
      fixturePayload({
        auth: { kind: "anonymous", claims: { role: "admin" } },
      }),
      fixturePayload({
        auth: {
          kind: "trustedDev",
          principal: "local-test",
          issuer: "forged",
        },
      }),
      fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: {},
          token: "raw-bearer-token",
        },
      }),
      { ...fixturePayload(), unexpected: true },
    ];
    const missingScope = fixturePayload();
    delete missingScope.scopeId;
    invalidInputs.push(missingScope);

    for (const [index, invalid] of invalidInputs.entries()) {
      try {
        await canonicalizeTransactionGrantPayloadV1(invalid);
      } catch (error) {
        expect(error, `invalid payload fixture ${index}`)
          .toBeInstanceOf(TransactionGrantProtocolV1Error);
        continue;
      }
      throw new Error(`Invalid payload fixture ${index} was accepted.`);
    }

    await expect(canonicalizeTransactionGrantPayloadV1(
      fixturePayload({ capabilities: [] }),
    )).resolves.toMatchObject({
      payload: { capabilities: [] },
    });

    const exactClaimsPrefixBytes = new TextEncoder().encode(
      JSON.stringify({ boundary: "" }),
    ).byteLength;
    await expect(canonicalizeTransactionGrantPayloadV1(fixturePayload({
      deploymentId: "x".repeat(MAX_TRANSACTION_GRANT_TEXT_UTF8_BYTES_V1),
      auth: {
        kind: "verifiedBearer",
        issuer: "https://identity.example.test",
        subject: "user_123",
        claims: {
          boundary: "x".repeat(
            MAX_TRANSACTION_GRANT_CLAIMS_JSON_UTF8_BYTES_V1 -
              exactClaimsPrefixBytes,
          ),
        },
      },
    }))).resolves.toBeDefined();
  });

  it("redacts rejected values from protocol errors", async () => {
    const secret = "secret-bearer-value-that-must-not-leak";
    try {
      await canonicalizeTransactionGrantPayloadV1(fixturePayload({
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user_123",
          claims: {},
          token: secret,
        },
      }));
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionGrantProtocolV1Error);
      if (!(error instanceof TransactionGrantProtocolV1Error)) throw error;
      expect(error.issue).toEqual({
        reason: "invalidSchema",
        field: "payload",
      });
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      return;
    }
    throw new Error("Payload containing an unexpected token was accepted.");
  });

  it("keeps authority-bearing hash brands distinct and round-trippable", () => {
    const identityHex =
      TransactionGrantIdentityAccessPolicySha256HexV1Schema.make(
        "a".repeat(64),
      );
    const argumentsHex = TransactionGrantValidatedArgsSha256HexV1Schema.make(
      "b".repeat(64),
    );
    const requestHex = TransactionGrantRequestSha256HexV1Schema.make(
      "c".repeat(64),
    );

    expectTypeOf<TransactionGrantIdentityAccessPolicySha256HexV1>()
      .not.toMatchTypeOf<TransactionGrantValidatedArgsSha256HexV1>();
    expectTypeOf<TransactionGrantValidatedArgsSha256HexV1>()
      .not.toMatchTypeOf<TransactionGrantRequestSha256HexV1>();
    expectTypeOf<TransactionGrantRequestSha256HexV1>()
      .not.toMatchTypeOf<TransactionGrantIdentityAccessPolicySha256HexV1>();

    const identityBytes =
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(identityHex);
    const argumentsBytes =
      transactionGrantValidatedArgsSha256BytesV1FromHex(argumentsHex);
    const requestBytes =
      transactionGrantRequestSha256BytesV1FromHex(requestHex);
    expect(identityBytes).toEqual(
      TransactionIdentityAccessPolicySha256V1Schema.make(
        new Uint8Array(32).fill(0xaa),
      ),
    );
    expect(argumentsBytes).toEqual(
      TransactionArgumentsSha256V1Schema.make(
        new Uint8Array(32).fill(0xbb),
      ),
    );
    expect(requestBytes).toEqual(
      TransactionRequestSha256V1Schema.make(
        new Uint8Array(32).fill(0xcc),
      ),
    );
    expect(transactionGrantIdentityAccessPolicySha256HexV1FromBytes(
      identityBytes,
    )).toBe(identityHex);
    expect(transactionGrantValidatedArgsSha256HexV1FromBytes(
      argumentsBytes,
    )).toBe(argumentsHex);
    expect(transactionGrantRequestSha256HexV1FromBytes(requestBytes)).toBe(
      requestHex,
    );
  });

  it("enforces direct quotas and proves segment caps imply the complete-envelope cap", async () => {
    const fixture = await signedFixture();
    const maximumKeyId = "k".repeat(
      MAX_TRANSACTION_GRANT_KEY_ID_UTF8_BYTES_V1,
    );
    const maximumHeader = canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid: maximumKeyId,
      typ: "flarex-transaction-grant+jws",
    });
    expect(maximumHeader.canonicalBytes.byteLength).toBeLessThanOrEqual(
      MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
    );
    expect(() => canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid: `${maximumKeyId}k`,
      typ: "flarex-transaction-grant+jws",
    })).toThrow(TransactionGrantProtocolV1Error);

    expect(() => encodeTransactionGrantEd25519SignatureV1(
      new Uint8Array(TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1 - 1),
    )).toThrow(TransactionGrantProtocolV1Error);
    expect(() => encodeTransactionGrantEd25519SignatureV1(
      new Uint8Array(TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1 + 1),
    )).toThrow(TransactionGrantProtocolV1Error);

    await expect(deriveInertTransactionGrantEvidenceV1({
      ...fixture.jws,
      protected: base64UrlFromBytes(new Uint8Array(
        MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1 + 1,
      )),
    })).rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    await expect(deriveInertTransactionGrantEvidenceV1({
      ...fixture.jws,
      payload: base64UrlFromBytes(new Uint8Array(
        MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1 + 1,
      )),
    })).rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    for (const signatureBytes of [
      TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1 - 1,
      TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1 + 1,
    ]) {
      await expect(deriveInertTransactionGrantEvidenceV1({
        ...fixture.jws,
        signature: base64UrlFromBytes(new Uint8Array(signatureBytes)),
      })).rejects.toBeInstanceOf(TransactionGrantProtocolV1Error);
    }

    const maximumSegmentEnvelope = await canonicalizeFlarexValueV1({
      protected: "A".repeat(base64UrlMaximumCharacters(
        MAX_TRANSACTION_GRANT_PROTECTED_HEADER_BYTES_V1,
      )),
      payload: "A".repeat(base64UrlMaximumCharacters(
        MAX_TRANSACTION_GRANT_PAYLOAD_CANONICAL_BYTES_V1,
      )),
      signature: "A".repeat(base64UrlMaximumCharacters(
        TRANSACTION_GRANT_ED25519_SIGNATURE_BYTES_V1,
      )),
    });
    expect(maximumSegmentEnvelope.canonicalBytes.byteLength).toBe(64_869);
    expect(maximumSegmentEnvelope.canonicalBytes.byteLength).toBeLessThan(
      MAX_TRANSACTION_GRANT_CANONICAL_BYTES_V1,
    );
    expect(fixture.evidence.authorizationGrantCanonicalBytes.byteLength)
      .toBeLessThanOrEqual(MAX_TRANSACTION_GRANT_CANONICAL_BYTES_V1);
  });

  it("makes every authority-bearing substitution fail the fixed signature", async () => {
    const fixture = await signedFixture();
    const substitutions: ReadonlyArray<Record<string, unknown>> = [
      { scopeId: "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874" },
      { packageId: "package_catalog_v2" },
      {
        sourcePackageHash: "e".repeat(64),
        artifactId: `artifact_${"e".repeat(32)}`,
      },
      { functionPath: "catalog:deleteProduct" },
      { schemaVersionId: "schema_version_catalog_v2" },
      { policyVersion: "policy_point_mutation_v2" },
      { validatedArgsSha256: "e".repeat(64) },
      { requestKey: "request_catalog_create_002" },
      { requestSha256: "e".repeat(64) },
      { capabilities: ["db:get", "db:delete"] },
      { auth: { kind: "anonymous" } },
      { authorizationRevocationEpoch: "8" },
      { expiresAt: "2026-07-14T10:04:00.000Z" },
    ];

    expect(await verifyEvidence(fixture.evidence)).toBe(true);
    for (const substitution of substitutions) {
      const changedPayload = await canonicalizeTransactionGrantPayloadV1(
        fixturePayload(substitution),
      );
      const changedEvidence = await deriveInertTransactionGrantEvidenceV1({
        ...fixture.jws,
        payload: changedPayload.base64url,
      });
      expect(await verifyEvidence(changedEvidence)).toBe(false);
      expect(changedEvidence.authorizationGrantSha256).not.toEqual(
        fixture.evidence.authorizationGrantSha256,
      );
    }

    const changedHeader = canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid: "grant-key-2026-08",
      typ: "flarex-transaction-grant+jws",
    });
    const changedHeaderEvidence = await deriveInertTransactionGrantEvidenceV1({
      ...fixture.jws,
      protected: changedHeader.base64url,
    });
    expect(await verifyEvidence(changedHeaderEvidence)).toBe(false);
  });
});

function fixturePayload(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    format: "flarex.transaction-grant",
    version: 1,
    grantId: "grant_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    deploymentId: "deployment_primary",
    scopeId: "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    packageId: "package_catalog_v1",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    executionModule: "flarex/catalog.ts",
    functionPath: "catalog:createProduct",
    functionKind: "mutation",
    schemaVersionId: "schema_version_catalog_v1",
    policyVersion: "policy_point_mutation_v1",
    identityAccessPolicySha256: "b".repeat(64),
    validatedArgsValueCodecVersion: 1,
    validatedArgsSha256: "c".repeat(64),
    requestKey: "request_catalog_create_001",
    requestSha256: "d".repeat(64),
    capabilities: ["db:get", "db:insert", "db:patch"],
    auth: {
      kind: "verifiedBearer",
      issuer: "https://identity.example.test",
      subject: "user_123",
      claims: { role: "editor", teams: ["catalog"] },
    },
    issuedAt: "2026-07-14T10:00:00.000Z",
    expiresAt: "2026-07-14T10:05:00.000Z",
    authorizationRevocationEpoch: "7",
    ...overrides,
  };
}

async function signedFixture(): Promise<{
  readonly header: ReturnType<
    typeof canonicalizeTransactionGrantProtectedHeaderV1
  >;
  readonly payload: Awaited<
    ReturnType<typeof canonicalizeTransactionGrantPayloadV1>
  >;
  readonly signingInput: ReturnType<
    typeof createTransactionGrantSigningInputV1
  >;
  readonly jws: TransactionGrantJwsV1;
  readonly evidence: InertTransactionGrantEvidenceV1;
}> {
  const header = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid: "grant-key-2026-07",
    typ: "flarex-transaction-grant+jws",
  });
  const payload = await canonicalizeTransactionGrantPayloadV1(
    fixturePayload(),
  );
  const signingInput = createTransactionGrantSigningInputV1({
    protected: header.base64url,
    payload: payload.base64url,
  });
  const privateKey = await importPrivateKey();
  const signatureBytes = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    copyBytesToArrayBuffer(signingInput),
  ));
  const jwsInput = {
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(signatureBytes),
  };
  const evidence = await deriveInertTransactionGrantEvidenceV1(jwsInput);
  return { header, payload, signingInput, jws: evidence.jws, evidence };
}

async function verifyEvidence(
  evidence: InertTransactionGrantEvidenceV1,
): Promise<boolean> {
  return crypto.subtle.verify(
    { name: "Ed25519" },
    await importPublicKey(),
    copyBytesToArrayBuffer(evidence.signatureBytes),
    copyBytesToArrayBuffer(evidence.signingInput),
  );
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

async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    copyBytesToArrayBuffer(decodeBase64(TEST_PUBLIC_KEY_SPKI_BASE64)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64UrlFromUtf8(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlMaximumCharacters(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(value),
  )));
}

function toHex(value: Uint8Array): string {
  return Array.from(
    value,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
