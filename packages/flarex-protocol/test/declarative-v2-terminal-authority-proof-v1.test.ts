import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
} from "../src/declarative-v2-verifier-progress-v2";
import {
  decodeDeclarativeV2TerminalAuthorityProofV1,
  encodeDeclarativeV2TerminalAuthorityProofV1,
  type DeclarativeV2TerminalAuthorityProofV1,
} from "../src/declarative-v2-terminal-authority-proof-v1";

const digest = (value: number): Uint8Array =>
  new Uint8Array(32).fill(value);
const vector = (value: bigint) => Object.freeze(Object.fromEntries(
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(
    dimension => [dimension, value],
  ),
)) as Readonly<Record<
  (typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2)[number],
  bigint
>>;

function fixture(): DeclarativeV2TerminalAuthorityProofV1 {
  return {
    authorityKind: "capacity",
    commandKind: "link_page",
    sequence: 7n,
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    reservationSha256: digest(3),
    requestSha256: digest(4),
    futureRegistrationIntentSha256: digest(5),
    commandBudgetSha256: digest(6),
    commandInputSha256: digest(7),
    freshAuthenticatedInputSha256: digest(8),
    rangeAndPredecessorTailsSha256: digest(9),
    analyzerReleaseSha256: digest(10),
    analyzerIdentitySha256: digest(11),
    verifierIdentitySha256: digest(12),
    currentProgressSha256: digest(13),
    nextProgressSha256: digest(14),
    outputManifestSha256: digest(15),
    receiptSha256: digest(16),
    predecessorReceiptSha256: digest(17),
    authority: vector(2n),
    actual: vector(1n),
  };
}

describe("DeclarativeV2TerminalAuthorityProofV1", () => {
  it("round-trips one fixed canonical proof and pins its digest", () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2TerminalAuthorityProofV1(fixture()),
    );
    expect(encoded.canonicalBytes.byteLength).toBe(1_026);
    expect(
      createHash("sha256").update(encoded.canonicalBytes).digest("hex"),
    ).toBe("dbf5155851cf07fd025ca615a61b605d810730fc56e43b49d88d7ece647d37f3");
    expect(Result.getOrThrow(
      decodeDeclarativeV2TerminalAuthorityProofV1(encoded.canonicalBytes),
    ).proof).toEqual(fixture());
  });

  it("rejects authority/actual violations and malformed optional digests", () => {
    expect(Result.isFailure(
      encodeDeclarativeV2TerminalAuthorityProofV1({
        ...fixture(),
        actual: vector(3n),
      }),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2TerminalAuthorityProofV1({
        ...fixture(),
        futureRegistrationIntentSha256: null,
      }),
    )).toBe(true);
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2TerminalAuthorityProofV1(fixture()),
    );
    const corrupted = new Uint8Array(encoded.canonicalBytes);
    corrupted[corrupted.byteLength - 1] ^= 1;
    expect(Result.isSuccess(
      decodeDeclarativeV2TerminalAuthorityProofV1(corrupted),
    )).toBe(true);
    corrupted[0] ^= 1;
    expect(Result.isFailure(
      decodeDeclarativeV2TerminalAuthorityProofV1(corrupted),
    )).toBe(true);
  });

  it("defensively owns proof vectors and digest bytes", () => {
    const input = fixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2TerminalAuthorityProofV1(input),
    );
    input.attemptSha256.fill(255);
    expect(encoded.proof.attemptSha256).toEqual(digest(1));
    const source = new Uint8Array(encoded.canonicalBytes);
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2TerminalAuthorityProofV1(source),
    );
    source.fill(0);
    expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
  });

  it("rejects accessor-backed proof and vector input without invoking getters", () => {
    let reads = 0;
    const hostileProof = { ...fixture() };
    Object.defineProperty(hostileProof, "requestSha256", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(Result.isFailure(
      encodeDeclarativeV2TerminalAuthorityProofV1(hostileProof),
    )).toBe(true);
    const hostileAuthority = { ...vector(2n) };
    Object.defineProperty(
      hostileAuthority,
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[0],
      {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error("must not run");
        },
      },
    );
    expect(Result.isFailure(
      encodeDeclarativeV2TerminalAuthorityProofV1({
        ...fixture(),
        authority: hostileAuthority,
      }),
    )).toBe(true);
    expect(reads).toBe(0);
  });
});
