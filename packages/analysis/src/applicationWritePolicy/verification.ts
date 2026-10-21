import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Context, Effect } from "effect";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

import { makeLivePrivateSha256V1, makePrivateSha256V1, type PrivateSha256V1,
  type PrivateSha256V1Foreign, type PrivateSha256V1ErrorPolicy } from "../privateSha256V1.ts";
import { decodeApplicationWritePolicies } from "./capture.ts";
import {
  APPLICATION_WRITE_POLICY_MAXIMUM_BYTES,
  ApplicationWritePolicyError,
  type ApplicationTableWritePolicy,
  type ApplicationWritePolicies,
} from "./model.ts";

const utf8 = new TextEncoder();
const digestErrors = {
  invalidBudget: () => new ApplicationWritePolicyError({ reason: "limitExceeded", path: "digest" }),
  invalidBytes: () => new ApplicationWritePolicyError({ reason: "invalidInput", path: "digest" }),
  inputBytesExceeded: () => new ApplicationWritePolicyError({ reason: "limitExceeded", path: "digest" }),
  unavailable: () => new ApplicationWritePolicyError({ reason: "digestUnavailable", path: "digest" }),
  nativeRejected: () => new ApplicationWritePolicyError({ reason: "digestUnavailable", path: "digest" }),
  invalidDigestOutput: () => new Error("SHA-256 returned invalid Application write-policy evidence"),
} satisfies PrivateSha256V1ErrorPolicy<ApplicationWritePolicyError>;
const liveDigest = makeLivePrivateSha256V1(digestErrors);
/** Trusted analyzer construction may supply host crypto while application globals stay sealed. */
export const ApplicationWritePolicyDigest = Context.Reference<PrivateSha256V1<ApplicationWritePolicyError>>(
  "Flarex/AnalysisWritePolicyDigest", { defaultValue: () => liveDigest });
export const makeApplicationWritePolicyDigest = (foreign: PrivateSha256V1Foreign) => makePrivateSha256V1(foreign, digestErrors);

export interface VerifiedApplicationWritePolicies {
  readonly policies: ApplicationWritePolicies;
  readonly policySetSha256: string;
  readonly tables: ReadonlyArray<Readonly<{
    readonly declaration: ApplicationTableWritePolicy;
    readonly writePolicySha256: string;
  }>>;
}

/** Verify references from captured evidence, never from caller-provided hashes alone. */
export const verifyApplicationWritePolicies = Effect.fn(
  "ApplicationWritePolicy.verify",
)(function* (
  input: unknown,
  logicalTableNames: ReadonlyArray<string>,
): Effect.fn.Return<VerifiedApplicationWritePolicies, ApplicationWritePolicyError> {
  const policies = yield* Effect.fromResult(decodeApplicationWritePolicies(input, logicalTableNames));
  const provenanceSha256 = yield* digestApplicationWritePolicyFrame(policies.provenance);
  if (policies.configuration.provenanceSha256 !== provenanceSha256) {
    return yield* Effect.fail(new ApplicationWritePolicyError({
      reason: "digestMismatch", path: "configuration.provenanceSha256",
    }));
  }
  const configSha256 = yield* digestApplicationWritePolicyFrame(policies.configuration);
  const tables: VerifiedApplicationWritePolicies["tables"][number][] = [];
  for (const declaration of policies.tables) {
    if (declaration.owner === "payload" && (
      declaration.provenanceSha256 !== provenanceSha256 ||
      declaration.configSha256 !== configSha256
    )) {
      return yield* Effect.fail(new ApplicationWritePolicyError({
        reason: "digestMismatch", path: `tables.${declaration.logicalTableName}`,
      }));
    }
    const writePolicySha256 = yield* digestApplicationWritePolicyFrame({
      format: "flarex.application-table-write-policy",
      version: 1,
      ...declaration,
    });
    tables.push(Object.freeze({ declaration, writePolicySha256 }));
  }
  const policySetSha256 = yield* digestApplicationWritePolicyFrame(policies);
  return Object.freeze({ policies, policySetSha256, tables: Object.freeze(tables) });
});

/** Internal hashing over already owned JSON; this operation issues no write authority. */
export const digestApplicationWritePolicyFrame = Effect.fn(
  "ApplicationWritePolicy.digestFrame",
)(function* (frame: Json): Effect.fn.Return<string, ApplicationWritePolicyError> {
  const bytes = utf8.encode(encodeCanonicalJson(frame, issue => {
    throw new Error(`Application write-policy frame lost JSON: ${issue.reason}`);
  }));
  const digest = yield* ApplicationWritePolicyDigest;
  return yield* digest(bytes, { maximumInputBytes: APPLICATION_WRITE_POLICY_MAXIMUM_BYTES }).pipe(
    Effect.map(encodeBytesToLowercaseHex),
  );
});
