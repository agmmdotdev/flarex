import { Effect } from "effect";

import type { ExecutionIdentity } from "./auth";
import type { Json } from "./json";
import {
  TransactionGrantCapabilitiesV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  type CanonicalTransactionGrantIdentityAccessPolicyV1,
  type TransactionGrantIdentityAccessPolicyV1Error,
  type TransactionGrantInertAuthV1,
} from "./transaction-grant";
import { TransactionPolicyVersionV1Schema } from "./transaction-session";

export const APPLICATION_QUERY_IDENTITY_ACCESS_POLICY_VERSION_V1 =
  TransactionPolicyVersionV1Schema.make("policy_query_v1");

export const APPLICATION_QUERY_IDENTITY_ACCESS_CAPABILITIES_V1 = Object.freeze(
  TransactionGrantCapabilitiesV1Schema.make(["db:get"]),
);

/**
 * Canonical read-only identity evidence for Application query matching. This
 * digest describes the effective identity and read capability; it grants no
 * execution authority.
 */
export const canonicalizeApplicationQueryIdentityAccessPolicyV1 = Effect.fn(
  "ApplicationQueryPolicy.canonicalizeIdentityAccessPolicyV1",
)(function* (
  identity: ExecutionIdentity,
): Effect.fn.Return<
  CanonicalTransactionGrantIdentityAccessPolicyV1,
  TransactionGrantIdentityAccessPolicyV1Error
> {
  return yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
    policyVersion: APPLICATION_QUERY_IDENTITY_ACCESS_POLICY_VERSION_V1,
    auth: transactionGrantAuthFromExecutionIdentity(identity),
    capabilities: APPLICATION_QUERY_IDENTITY_ACCESS_CAPABILITIES_V1,
  });
});

function transactionGrantAuthFromExecutionIdentity(
  identity: ExecutionIdentity,
): TransactionGrantInertAuthV1 {
  if (identity.kind === "anonymous") {
    return Object.freeze({ kind: "anonymous" as const });
  }
  const user = identity.user;
  const claims: Record<string, Json> = {};
  for (const [key, value] of Object.entries(user)) {
    if (
      key === "tokenIdentifier" ||
      key === "issuer" ||
      key === "subject" ||
      value === undefined
    ) continue;
    Object.defineProperty(claims, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: freezeOwnedIdentityJson(value),
    });
  }
  return Object.freeze({
    kind: "verifiedBearer" as const,
    issuer: user.issuer,
    subject: user.subject,
    tokenIdentifier: user.tokenIdentifier,
    claims: Object.freeze(claims),
  });
}

function freezeOwnedIdentityJson(value: Json): Json {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeOwnedIdentityJson));
  }
  if (typeof value === "object" && value !== null) {
    const owned: Record<string, Json> = {};
    for (const [key, member] of Object.entries(value)) {
      Object.defineProperty(owned, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: freezeOwnedIdentityJson(member),
      });
    }
    return Object.freeze(owned);
  }
  return value;
}
