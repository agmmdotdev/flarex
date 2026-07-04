import { Data, Effect, Schema } from "effect";
import { isJson, type Json } from "./json";

export interface UserIdentity {
  readonly tokenIdentifier: string;
  readonly subject: string;
  readonly issuer: string;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly nickname?: string;
  readonly preferredUsername?: string;
  readonly profileUrl?: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly gender?: string;
  readonly birthday?: string;
  readonly timezone?: string;
  readonly language?: string;
  readonly phoneNumber?: string;
  readonly phoneNumberVerified?: boolean;
  readonly address?: string;
  readonly updatedAt?: string;
  readonly [claim: string]: Json | undefined;
}

export type UserIdentityAttributes = Omit<UserIdentity, "tokenIdentifier">;

export type AuthConfig = {
  readonly providers: ReadonlyArray<AuthProvider>;
};

export type AuthProvider = OidcAuthProvider | CustomJwtAuthProvider;

export type OidcAuthProvider = {
  readonly domain: string;
  readonly applicationID: string;
};

export type CustomJwtAlgorithm = "RS256" | "ES256";

export type CustomJwtAuthProvider = {
  readonly type: "customJwt";
  readonly issuer: string;
  readonly jwks: string;
  readonly algorithm: CustomJwtAlgorithm;
  readonly applicationID?: string;
};

export type ExecutionIdentity =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly user: UserIdentity };

export function executionIdentityFingerprint(identity: ExecutionIdentity): string {
  return `identity:v1:${fnv1a64Hex(stableIdentityJson(identity))}`;
}

export class AuthProtocolValidationError extends Data.TaggedError(
  "AuthProtocolValidationError",
)<{
  readonly schema: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const UserIdentitySchema = Schema.declare<UserIdentity>(
  isUserIdentity,
  {
    title: "UserIdentity",
    description:
      "A Convex-compatible authenticated user identity with JSON custom claims.",
  },
);

export const ExecutionIdentitySchema = Schema.declare<ExecutionIdentity>(
  isExecutionIdentity,
  {
    title: "ExecutionIdentity",
    description:
      "An execution identity that is either anonymous or a validated user identity.",
  },
);

export const AuthProviderSchema = Schema.declare<AuthProvider>(
  isAuthProvider,
  {
    title: "AuthProvider",
    description:
      "A Convex-compatible OIDC or custom JWT auth provider configuration.",
  },
);

export const AuthConfigSchema = Schema.declare<AuthConfig>(
  isAuthConfig,
  {
    title: "AuthConfig",
    description:
      "A backend-owned auth provider configuration for validating bearer tokens.",
  },
);

const decodeUnknownUserIdentity = Schema.decodeUnknownEffect(UserIdentitySchema);
const decodeUnknownExecutionIdentity = Schema.decodeUnknownEffect(
  ExecutionIdentitySchema,
);
const decodeUnknownAuthProvider = Schema.decodeUnknownEffect(AuthProviderSchema);
const decodeUnknownAuthConfig = Schema.decodeUnknownEffect(AuthConfigSchema);

export const decodeUserIdentityEffect = Effect.fn(
  "AuthProtocol.decodeUserIdentity",
)(function* (
  value: unknown,
): Effect.fn.Return<UserIdentity, AuthProtocolValidationError> {
  return yield* decodeUnknownUserIdentity(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "UserIdentity",
        message:
          "User identity must include string tokenIdentifier, subject, issuer, optional OIDC fields, and JSON custom claims.",
        cause,
      })
    ),
  );
});

export const decodeExecutionIdentityEffect = Effect.fn(
  "AuthProtocol.decodeExecutionIdentity",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionIdentity, AuthProtocolValidationError> {
  return yield* decodeUnknownExecutionIdentity(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "ExecutionIdentity",
        message:
          "Execution identity must be anonymous or include a valid user identity.",
        cause,
      })
    ),
  );
});

export const decodeAuthProviderEffect = Effect.fn(
  "AuthProtocol.decodeAuthProvider",
)(function* (
  value: unknown,
): Effect.fn.Return<AuthProvider, AuthProtocolValidationError> {
  return yield* decodeUnknownAuthProvider(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "AuthProvider",
        message:
          "Auth provider must be an OIDC provider with domain and applicationID or a customJwt provider with issuer, jwks, algorithm, and optional applicationID.",
        cause,
      })
    ),
  );
});

export const decodeAuthConfigEffect = Effect.fn(
  "AuthProtocol.decodeAuthConfig",
)(function* (
  value: unknown,
): Effect.fn.Return<AuthConfig, AuthProtocolValidationError> {
  return yield* decodeUnknownAuthConfig(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "AuthConfig",
        message: "Auth config must include a providers array of valid auth providers.",
        cause,
      })
    ),
  );
});

export function decodeAuthConfigPromise(value: unknown): Promise<AuthConfig> {
  return Effect.runPromise(decodeAuthConfigEffect(value));
}

function isAuthConfig(value: unknown): value is AuthConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, ["providers"])) return false;
  return Array.isArray(value.providers) && value.providers.every(isAuthProvider);
}

function isAuthProvider(value: unknown): value is AuthProvider {
  if (!isRecord(value)) return false;
  if (value.type === "customJwt") return isCustomJwtAuthProvider(value);
  return isOidcAuthProvider(value);
}

function isOidcAuthProvider(value: Record<string, unknown>): value is OidcAuthProvider {
  return (
    hasOnlyKeys(value, ["applicationID", "domain"]) &&
    typeof value.applicationID === "string" &&
    value.applicationID.length > 0 &&
    typeof value.domain === "string" &&
    value.domain.length > 0
  );
}

function isCustomJwtAuthProvider(
  value: Record<string, unknown>,
): value is CustomJwtAuthProvider {
  if (
    !hasOnlyKeys(value, ["algorithm", "applicationID", "issuer", "jwks", "type"]) ||
    value.type !== "customJwt" ||
    typeof value.issuer !== "string" ||
    value.issuer.length === 0 ||
    typeof value.jwks !== "string" ||
    value.jwks.length === 0 ||
    !isCustomJwtAlgorithm(value.algorithm)
  ) {
    return false;
  }
  return value.applicationID === undefined ||
    (typeof value.applicationID === "string" && value.applicationID.length > 0);
}

function isCustomJwtAlgorithm(value: unknown): value is CustomJwtAlgorithm {
  return value === "RS256" || value === "ES256";
}

function isExecutionIdentity(value: unknown): value is ExecutionIdentity {
  if (!isRecord(value)) return false;
  if (value.kind === "anonymous") {
    return !("user" in value);
  }
  if (value.kind === "user") {
    return isUserIdentity(value.user);
  }
  return false;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlyArray<string>,
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every(key => allowed.has(key));
}

function isUserIdentity(value: unknown): value is UserIdentity {
  if (!isRecord(value)) return false;
  if (
    typeof value.tokenIdentifier !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.issuer !== "string"
  ) {
    return false;
  }
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    if (isKnownStringClaim(key)) {
      if (typeof field !== "string") return false;
      continue;
    }
    if (isKnownBooleanClaim(key)) {
      if (typeof field !== "boolean") return false;
      continue;
    }
    if (!isJson(field)) return false;
  }
  return true;
}

function isKnownStringClaim(key: string): boolean {
  return (
    key === "tokenIdentifier" ||
    key === "subject" ||
    key === "issuer" ||
    key === "name" ||
    key === "givenName" ||
    key === "familyName" ||
    key === "nickname" ||
    key === "preferredUsername" ||
    key === "profileUrl" ||
    key === "pictureUrl" ||
    key === "email" ||
    key === "gender" ||
    key === "birthday" ||
    key === "timezone" ||
    key === "language" ||
    key === "phoneNumber" ||
    key === "address" ||
    key === "updatedAt"
  );
}

function isKnownBooleanClaim(key: string): boolean {
  return key === "emailVerified" || key === "phoneNumberVerified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.getOwnPropertySymbols(value).length === 0;
}

function stableIdentityJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableIdentityJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableIdentityJson(record[key])}`)
    .join(",")}}`;
}

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
