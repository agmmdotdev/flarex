import { Data, Effect } from "effect";
import type {
  AuthConfig,
  AuthProvider,
  CustomJwtAuthProvider,
  CustomJwtAlgorithm,
  ExecutionIdentity,
  OidcAuthProvider,
  UserIdentity,
} from "flarex-protocol/auth";
import { isJson, type Json } from "flarex-protocol/json";
import { HttpError } from "./http";
import { ANONYMOUS_EXECUTION_IDENTITY } from "./auth";

export type JwtAuthFailureReason =
  | "invalidAuthorization"
  | "invalidToken"
  | "noProvider"
  | "jwksFetchFailed"
  | "jwksInvalid"
  | "signatureInvalid"
  | "claimsInvalid";

export class JwtAuthError extends Data.TaggedError("JwtAuthError")<{
  readonly reason: JwtAuthFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type JwtAuthFetch = (url: string) => Promise<Response>;

export interface ResolveBearerExecutionIdentityInput {
  readonly authorization: string | null;
  readonly authConfig: AuthConfig | null;
  readonly fetch?: JwtAuthFetch;
  readonly now?: Date;
}

export interface VerifyBearerTokenInput {
  readonly token: string;
  readonly authConfig: AuthConfig;
  readonly fetch?: JwtAuthFetch;
  readonly now?: Date;
}

interface ParsedJwt {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
  readonly signingInput: Uint8Array;
  readonly signature: Uint8Array;
}

interface JwtHeader {
  readonly alg: "RS256" | "ES256";
  readonly kid?: string;
}

interface JwtPayload {
  readonly issuer: string;
  readonly subject: string;
  readonly audiences: ReadonlyArray<string>;
  readonly expiresAt: number;
  readonly notBefore?: number;
  readonly raw: Record<string, unknown>;
}

type VerifiedProvider =
  | {
      readonly type: "oidc";
      readonly provider: OidcAuthProvider;
      readonly issuer: string;
      readonly jwksUri: string;
      readonly algorithms: ReadonlyArray<CustomJwtAlgorithm>;
    }
  | {
      readonly type: "customJwt";
      readonly provider: CustomJwtAuthProvider;
      readonly issuer: string;
      readonly jwksUri: string;
      readonly algorithms: ReadonlyArray<CustomJwtAlgorithm>;
    };

interface JwksDocument {
  readonly keys: ReadonlyArray<StoredJsonWebKey>;
}

type StoredJsonWebKey = JsonWebKey & {
  readonly kid?: string;
  readonly alg?: string;
};

export const resolveBearerExecutionIdentityEffect = Effect.fn(
  "JwtAuth.resolveBearerExecutionIdentity",
)(function* (
  input: ResolveBearerExecutionIdentityInput,
): Effect.fn.Return<ExecutionIdentity, JwtAuthError> {
  const token = yield* bearerTokenFromAuthorizationEffect(input.authorization);
  if (token === null) return ANONYMOUS_EXECUTION_IDENTITY;
  if (input.authConfig === null || input.authConfig.providers.length === 0) {
    return yield* failJwtAuth(
      "noProvider",
      "Bearer token was provided but no auth providers are configured.",
    );
  }
  return yield* verifyBearerTokenEffect({
    token,
    authConfig: input.authConfig,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
});

export const verifyBearerTokenEffect = Effect.fn(
  "JwtAuth.verifyBearerToken",
)(function* (
  input: VerifyBearerTokenInput,
): Effect.fn.Return<ExecutionIdentity, JwtAuthError> {
  return yield* Effect.tryPromise({
    try: () => verifyBearerToken(input),
    catch: cause =>
      cause instanceof JwtAuthError
        ? cause
        : new JwtAuthError({
            reason: "invalidToken",
            message: "Bearer token could not be verified.",
            cause,
          }),
  });
});

export const bearerTokenFromAuthorizationEffect = Effect.fn(
  "JwtAuth.bearerTokenFromAuthorization",
)(function* (
  authorization: string | null,
): Effect.fn.Return<string | null, JwtAuthError> {
  if (authorization === null) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (
    scheme?.toLowerCase() !== "bearer" ||
    token === undefined ||
    token.length === 0 ||
    extra !== undefined
  ) {
    return yield* failJwtAuth(
      "invalidAuthorization",
      "Authorization header must be a Bearer token.",
    );
  }
  return token;
});

export function jwtAuthErrorToHttpError(error: JwtAuthError): HttpError {
  return new HttpError(401, "Authentication failed.");
}

async function verifyBearerToken(input: VerifyBearerTokenInput): Promise<ExecutionIdentity> {
  const parsed = parseJwt(input.token);
  const provider = selectProvider(input.authConfig.providers, parsed.payload);
  const jwks = await loadProviderJwks(provider, input.fetch ?? fetch);
  await verifyJwtSignature(parsed, provider.algorithms, jwks);
  validateJwtClaims(parsed.payload, provider, input.now ?? new Date());
  return { kind: "user", user: userIdentityFromJwtPayload(parsed.payload) };
}

function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT must have three base64url encoded parts.",
    });
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT must have header, payload, and signature parts.",
    });
  }
  const header = parseJwtHeader(jsonFromBase64Url(encodedHeader));
  const payload = parseJwtPayload(jsonFromBase64Url(encodedPayload));
  return {
    header,
    payload,
    signingInput: new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    signature: bytesFromBase64Url(encodedSignature),
  };
}

function parseJwtHeader(value: unknown): JwtHeader {
  if (!isRecord(value)) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT header must be a JSON object.",
    });
  }
  if (value.alg !== "RS256" && value.alg !== "ES256") {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT alg must be RS256 or ES256.",
    });
  }
  if (value.kid !== undefined && typeof value.kid !== "string") {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT kid must be a string when present.",
    });
  }
  return {
    alg: value.alg,
    ...(value.kid === undefined ? {} : { kid: value.kid }),
  };
}

function parseJwtPayload(value: unknown): JwtPayload {
  if (!isRecord(value)) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT payload must be a JSON object.",
    });
  }
  if (typeof value.iss !== "string" || value.iss.length === 0) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT payload must include a non-empty iss claim.",
    });
  }
  if (typeof value.sub !== "string" || value.sub.length === 0) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT payload must include a non-empty sub claim.",
    });
  }
  if (typeof value.exp !== "number" || !Number.isFinite(value.exp)) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT payload must include a numeric exp claim.",
    });
  }
  if (value.nbf !== undefined && (typeof value.nbf !== "number" || !Number.isFinite(value.nbf))) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT nbf claim must be numeric when present.",
    });
  }
  const notBefore = value.nbf;
  return {
    issuer: value.iss,
    subject: value.sub,
    audiences: audiencesFromClaim(value.aud),
    expiresAt: value.exp,
    ...(notBefore === undefined ? {} : { notBefore }),
    raw: value,
  };
}

function selectProvider(
  providers: ReadonlyArray<AuthProvider>,
  payload: JwtPayload,
): VerifiedProvider {
  const provider = providers.find(candidate => providerMatchesPayload(candidate, payload));
  if (provider === undefined) {
    throw new JwtAuthError({
      reason: "noProvider",
      message:
        "No auth provider matches the JWT issuer and audience claims.",
    });
  }
  if (isCustomJwtProvider(provider)) {
    return {
      type: "customJwt",
      provider,
      issuer: provider.issuer,
      jwksUri: provider.jwks,
      algorithms: [provider.algorithm],
    };
  }
  return {
    type: "oidc",
    provider,
    issuer: provider.domain,
    jwksUri: "",
    algorithms: ["RS256", "ES256"],
  };
}

function providerMatchesPayload(provider: AuthProvider, payload: JwtPayload): boolean {
  const applicationId = provider.applicationID;
  if (applicationId !== undefined && !payload.audiences.includes(applicationId)) {
    return false;
  }
  const issuer =
    isCustomJwtProvider(provider)
      ? provider.issuer
      : provider.domain;
  return normalizedIssuer(payload.issuer) === normalizedIssuer(issuer);
}

async function loadProviderJwks(
  provider: VerifiedProvider,
  fetcher: JwtAuthFetch,
): Promise<JwksDocument> {
  if (provider.type === "customJwt") {
    return fetchJwks(provider.jwksUri, fetcher);
  }
  const discovery = await fetchJson(normalizedOidcDiscoveryUrl(provider.issuer), fetcher, "jwksFetchFailed");
  if (!isRecord(discovery) || typeof discovery.jwks_uri !== "string" || discovery.jwks_uri.length === 0) {
    throw new JwtAuthError({
      reason: "jwksInvalid",
      message: "OIDC discovery response must include a non-empty jwks_uri.",
    });
  }
  if (
    typeof discovery.issuer !== "string" ||
    normalizedIssuer(discovery.issuer) !== normalizedIssuer(provider.issuer)
  ) {
    throw new JwtAuthError({
      reason: "jwksInvalid",
      message: "OIDC discovery response must include an issuer matching the configured provider issuer.",
    });
  }
  return fetchJwks(discovery.jwks_uri, fetcher);
}

async function fetchJwks(url: string, fetcher: JwtAuthFetch): Promise<JwksDocument> {
  const value = await fetchJson(url, fetcher, "jwksFetchFailed");
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new JwtAuthError({
      reason: "jwksInvalid",
      message: "JWKS response must include a keys array.",
    });
  }
  const keys = value.keys.flatMap((key): StoredJsonWebKey[] => {
    const jwk = jsonWebKeyFromUnknown(key);
    return jwk === null ? [] : [jwk];
  });
  if (keys.length === 0) {
    throw new JwtAuthError({
      reason: "jwksInvalid",
      message: "JWKS response did not include any supported keys.",
    });
  }
  return { keys };
}

async function fetchJson(
  url: string,
  fetcher: JwtAuthFetch,
  failureReason: JwtAuthFailureReason,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (cause) {
    throw new JwtAuthError({
      reason: failureReason,
      message: `Failed to fetch auth metadata from ${url}.`,
      cause,
    });
  }
  if (!response.ok) {
    throw new JwtAuthError({
      reason: failureReason,
      message: `Auth metadata request failed with status ${response.status}.`,
    });
  }
  try {
    const value: unknown = await response.json();
    return value;
  } catch (cause) {
    throw new JwtAuthError({
      reason: "jwksInvalid",
      message: `Auth metadata response from ${url} must be JSON.`,
      cause,
    });
  }
}

async function verifyJwtSignature(
  parsed: ParsedJwt,
  algorithms: ReadonlyArray<CustomJwtAlgorithm>,
  jwks: JwksDocument,
): Promise<void> {
  if (!algorithms.includes(parsed.header.alg)) {
    throw new JwtAuthError({
      reason: "signatureInvalid",
      message: "JWT alg is not allowed for the matched auth provider.",
    });
  }
  const keys = jwks.keys.filter(key => keyMatchesJwt(key, parsed.header));
  if (keys.length === 0) {
    throw new JwtAuthError({
      reason: "signatureInvalid",
      message: "No JWKS key matches the JWT header.",
    });
  }
  for (const key of keys) {
    if (await verifyJwtSignatureWithKey(parsed, key)) return;
  }
  throw new JwtAuthError({
    reason: "signatureInvalid",
    message: "JWT signature could not be verified with the matched JWKS keys.",
  });
}

async function verifyJwtSignatureWithKey(
  parsed: ParsedJwt,
  jwk: StoredJsonWebKey,
): Promise<boolean> {
  const algorithm = cryptoAlgorithmForJwtAlg(parsed.header.alg);
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      algorithm.importAlgorithm,
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      algorithm.verifyAlgorithm,
      key,
      arrayBufferFromBytes(parsed.signature),
      arrayBufferFromBytes(parsed.signingInput),
    );
  } catch {
    return false;
  }
}

function validateJwtClaims(
  payload: JwtPayload,
  provider: VerifiedProvider,
  now: Date,
): void {
  if (normalizedIssuer(payload.issuer) !== normalizedIssuer(provider.issuer)) {
    throw new JwtAuthError({
      reason: "claimsInvalid",
      message: "JWT issuer does not match the matched auth provider.",
    });
  }
  validateProviderAudienceClaims(payload, provider);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const leewaySeconds = 5;
  if (payload.expiresAt + leewaySeconds < nowSeconds) {
    throw new JwtAuthError({
      reason: "claimsInvalid",
      message: "JWT is expired.",
    });
  }
  if (payload.notBefore !== undefined && payload.notBefore - leewaySeconds > nowSeconds) {
    throw new JwtAuthError({
      reason: "claimsInvalid",
      message: "JWT is not valid yet.",
    });
  }
}

function validateProviderAudienceClaims(
  payload: JwtPayload,
  provider: VerifiedProvider,
): void {
  if (provider.type === "oidc") {
    if (
      payload.audiences.length !== 1 ||
      payload.audiences[0] !== provider.provider.applicationID
    ) {
      throw new JwtAuthError({
        reason: "claimsInvalid",
        message: "OIDC JWT audience must contain exactly the configured application ID.",
      });
    }
    return;
  }
  const applicationId = provider.provider.applicationID;
  if (applicationId !== undefined && !payload.audiences.includes(applicationId)) {
    throw new JwtAuthError({
      reason: "claimsInvalid",
      message: "JWT audience does not match the matched auth provider.",
    });
  }
}

function userIdentityFromJwtPayload(payload: JwtPayload): UserIdentity {
  return {
    ...customClaims(payload.raw),
    tokenIdentifier: `${payload.issuer}|${payload.subject}`,
    subject: payload.subject,
    issuer: payload.issuer,
    ...stringClaimEntry("name", payload.raw.name),
    ...stringClaimEntry("givenName", payload.raw.given_name),
    ...stringClaimEntry("familyName", payload.raw.family_name),
    ...stringClaimEntry("nickname", payload.raw.nickname),
    ...stringClaimEntry("preferredUsername", payload.raw.preferred_username),
    ...stringClaimEntry("profileUrl", payload.raw.profile),
    ...stringClaimEntry("pictureUrl", payload.raw.picture),
    ...stringClaimEntry("email", payload.raw.email),
    ...booleanClaimEntry("emailVerified", payload.raw.email_verified),
    ...stringClaimEntry("gender", payload.raw.gender),
    ...stringClaimEntry("birthday", payload.raw.birthdate),
    ...stringClaimEntry("timezone", payload.raw.zoneinfo),
    ...stringClaimEntry("language", payload.raw.locale),
    ...stringClaimEntry("phoneNumber", payload.raw.phone_number),
    ...booleanClaimEntry("phoneNumberVerified", payload.raw.phone_number_verified),
    ...stringClaimEntry("address", payload.raw.address),
    ...stringClaimEntry("updatedAt", payload.raw.updated_at),
  };
}

function customClaims(raw: Record<string, unknown>): Record<string, Json> {
  const claims: Record<string, Json> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (standardJwtClaims.has(key)) continue;
    if (reservedUserIdentityClaims.has(key)) continue;
    if (isJson(value)) claims[key] = value;
  }
  return claims;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringClaimEntry(
  key: keyof UserIdentity,
  value: unknown,
): Partial<UserIdentity> {
  const claim = stringClaim(value);
  return claim === undefined ? {} : { [key]: claim };
}

function booleanClaimEntry(
  key: keyof UserIdentity,
  value: unknown,
): Partial<UserIdentity> {
  return typeof value === "boolean" ? { [key]: value } : {};
}

function keyMatchesJwt(jwk: StoredJsonWebKey, header: JwtHeader): boolean {
  if (typeof jwk.alg === "string" && jwk.alg !== header.alg) return false;
  if (header.kid === undefined) return true;
  return jwk.kid === header.kid;
}

function jsonWebKeyFromUnknown(value: unknown): StoredJsonWebKey | null {
  if (!isRecord(value) || typeof value.kty !== "string") return null;
  if (value.kty === "RSA") {
    return rsaJsonWebKey(value);
  }
  if (value.kty === "EC") {
    return ecJsonWebKey(value);
  }
  return null;
}

function rsaJsonWebKey(value: Record<string, unknown>): StoredJsonWebKey | null {
  if (typeof value.n !== "string" || typeof value.e !== "string") return null;
  return {
    kty: "RSA",
    n: value.n,
    e: value.e,
    ext: true,
    ...stringClaimEntryForJwk("kid", value.kid),
    ...stringClaimEntryForJwk("alg", value.alg),
    ...stringClaimEntryForJwk("use", value.use),
  };
}

function ecJsonWebKey(value: Record<string, unknown>): StoredJsonWebKey | null {
  if (
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    typeof value.y !== "string"
  ) {
    return null;
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: value.x,
    y: value.y,
    ext: true,
    ...stringClaimEntryForJwk("kid", value.kid),
    ...stringClaimEntryForJwk("alg", value.alg),
    ...stringClaimEntryForJwk("use", value.use),
  };
}

function stringClaimEntryForJwk(
  key: "alg" | "kid" | "use",
  value: unknown,
): Partial<StoredJsonWebKey> {
  const claim = stringClaim(value);
  return claim === undefined ? {} : { [key]: claim };
}

function cryptoAlgorithmForJwtAlg(alg: CustomJwtAlgorithm): {
  readonly importAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  readonly verifyAlgorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
} {
  if (alg === "RS256") {
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    return {
      importAlgorithm: algorithm,
      verifyAlgorithm: algorithm,
    };
  }
  return {
    importAlgorithm: { name: "ECDSA", namedCurve: "P-256" },
    verifyAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  };
}

function audiencesFromClaim(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((audience): string[] =>
      typeof audience === "string" ? [audience] : [],
    );
  }
  return [];
}

function normalizedIssuer(value: string): string {
  const withProtocol =
    value.startsWith("https://") || value.startsWith("http://")
      ? value
      : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizedOidcDiscoveryUrl(issuer: string): string {
  return `${normalizedIssuer(issuer)}/.well-known/openid-configuration`;
}

function jsonFromBase64Url(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(value)));
    return parsed;
  } catch (cause) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT header and payload must be base64url encoded JSON.",
      cause,
    });
  }
}

function bytesFromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4 || 4)), "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (cause) {
    throw new JwtAuthError({
      reason: "invalidToken",
      message: "JWT part is not valid base64url.",
      cause,
    });
  }
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function failJwtAuth(
  reason: JwtAuthFailureReason,
  message: string,
): Effect.Effect<never, JwtAuthError> {
  return Effect.fail(new JwtAuthError({ reason, message }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCustomJwtProvider(provider: AuthProvider): provider is CustomJwtAuthProvider {
  return "type" in provider && provider.type === "customJwt";
}

const standardJwtClaims = new Set([
  "iss",
  "sub",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "name",
  "given_name",
  "family_name",
  "nickname",
  "preferred_username",
  "profile",
  "picture",
  "website",
  "email",
  "email_verified",
  "gender",
  "birthdate",
  "zoneinfo",
  "locale",
  "phone_number",
  "phone_number_verified",
  "address",
  "updated_at",
]);

const reservedUserIdentityClaims = new Set([
  "tokenIdentifier",
  "subject",
  "issuer",
  "name",
  "givenName",
  "familyName",
  "nickname",
  "preferredUsername",
  "profileUrl",
  "pictureUrl",
  "email",
  "emailVerified",
  "gender",
  "birthday",
  "timezone",
  "language",
  "phoneNumber",
  "phoneNumberVerified",
  "address",
  "updatedAt",
]);
