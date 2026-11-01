import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureDocumentObject } from "../src/document-value";
import {
  coreApplicationArgumentsFromJson, coreApplicationValueFromJson, coreApplicationValueToJson,
  decodeCoreApplicationInvocationRequest, encodeCoreApplicationInvocationRequest,
  decodeCoreApplicationInvocationSuccess, encodeCoreApplicationInvocationSuccess,
  decodeCoreApplicationRegistrationRequest, decodeCoreApplicationProfile,
  type CoreApplicationInvocationRequest, type CoreApplicationInvocationSuccess,
} from "../src/core-application";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "../src/transaction-session";

const route = { deploymentId: "core-test", scopeUuid: "11000000-0000-4000-8000-000000000001",
  epochUuid: "11000000-0000-4000-8000-000000000002" };
const request = (): CoreApplicationInvocationRequest => ({
  format: "flarex.core-application.request", version: 1, kind: "query",
  functionPath: TransactionFunctionPathV1Schema.make("items:list"), requestKey: TransactionRequestKeyV1Schema.make("query-1"),
  sourceArtifactRootSha256: "a".repeat(64), auth: { kind: "anonymous" },
  args: Result.getOrThrow(captureDocumentObject({ count: 9007199254740993n, zero: -0,
    bytes: new Uint8Array([1, 2, 3]).buffer })),
});
const query = (): CoreApplicationInvocationSuccess => ({
  format: "flarex.core-application.response", version: 1, kind: "query", route,
  functionPath: request().functionPath, requestKey: request().requestKey, value: 9007199254740993n,
  evaluation: { timestamp: 9007199254740993n, reads: [{ indexId: new Uint8Array(16).fill(1),
    intervals: [{ start: null, end: new Uint8Array([0, 1]) }] }],
    metadataReadFrontiers: [{ timestamp: 9223372036854775807n, reads: [] }] },
});

describe("Core whole-function protocol", () => {
  it("round trips source-pinned arguments with exact native values and authenticated identity", () => {
    const original = { ...request(), auth: { kind: "user" as const,
      user: { tokenIdentifier: "issuer|subject", subject: "subject", issuer: "issuer", customClaims: { role: "editor" } } } };
    const wire = Result.getOrThrow(encodeCoreApplicationInvocationRequest(original));
    const decoded = Result.getOrThrow(decodeCoreApplicationInvocationRequest(JSON.parse(JSON.stringify(wire))));
    expect(decoded.auth).toEqual(original.auth);
    expect(decoded.args.count).toBe(9007199254740993n);
    expect(Object.is(decoded.args.zero, -0)).toBe(true);
    expect(decoded.args.bytes).toEqual(original.args.bytes);
    expect(decoded.args.bytes).not.toBe(original.args.bytes);
  });

  it.each(["instanceName", "manifest", "transaction", "namespace", "route"])("rejects untrusted %s configuration", key => {
    const wire = Result.getOrThrow(encodeCoreApplicationInvocationRequest(request()));
    expect(Result.isFailure(decodeCoreApplicationInvocationRequest({ ...wire, [key]: {} }))).toBe(true);
  });

  it.each([{ kind: "register" }, { requestKey: "" }, { sourceArtifactRootSha256: "bad" },
    { sourceArtifactRootSha256: undefined }, { auth: { kind: "admin" } }, { args: null }])("refuses invalid invocation %j", patch => {
    const wire = Result.getOrThrow(encodeCoreApplicationInvocationRequest(request()));
    expect(Result.isFailure(decodeCoreApplicationInvocationRequest({ ...wire, ...patch }))).toBe(true);
  });

  it("preserves Core read intervals and distinct metadata frontiers without numeric conversion", () => {
    const wire = Result.getOrThrow(encodeCoreApplicationInvocationSuccess(query()));
    expect(wire).toMatchObject({ evaluation: { timestamp: "9007199254740993",
      metadataReadFrontiers: [{ timestamp: "9223372036854775807" }] } });
    const decoded = Result.getOrThrow(decodeCoreApplicationInvocationSuccess(JSON.parse(JSON.stringify(wire))));
    expect(decoded).toEqual(query());
    expect(decoded).not.toHaveProperty("readSet");
    expect(decoded).not.toHaveProperty("commitSeq");
  });

  it.each(["-1", "01", "+1", "9223372036854775808", "9".repeat(100)])("rejects invalid timestamp %s", timestamp => {
    const output = query();
    const wire = Result.getOrThrow(encodeCoreApplicationInvocationSuccess(output));
    if (wire.kind !== "query") throw new Error("Expected a query fixture");
    expect(Result.isFailure(decodeCoreApplicationInvocationSuccess({ ...wire,
      evaluation: { ...wire.evaluation, timestamp } }))).toBe(true);
  });

  it("encodes a committed mutation timestamp and replay disposition exactly", () => {
    const original: CoreApplicationInvocationSuccess = { format: "flarex.core-application.response", version: 1,
      kind: "mutation", route, functionPath: request().functionPath, requestKey: request().requestKey,
      disposition: "replayed", publishedTimestamp: 9223372036854775807n, value: new Uint8Array([255]).buffer };
    expect(Result.getOrThrow(decodeCoreApplicationInvocationSuccess(Result.getOrThrow(
      encodeCoreApplicationInvocationSuccess(original))))).toEqual(original);
  });

  it("uses the document codec for public JSON and rejects non-object arguments", () => {
    for (const value of [Infinity, -Infinity, NaN, -0, 1n, new Uint8Array([9]).buffer]) {
      const decoded = Result.getOrThrow(coreApplicationValueFromJson(Result.getOrThrow(coreApplicationValueToJson(value))));
      if (typeof value === "number") expect(Object.is(decoded, value)).toBe(true);
      else expect(decoded).toEqual(value);
    }
    expect(Result.isFailure(coreApplicationArgumentsFromJson(null))).toBe(true);
    expect(Result.isFailure(coreApplicationArgumentsFromJson([]))).toBe(true);
    expect(Result.isFailure(coreApplicationValueFromJson({ $integer: "bad" }))).toBe(true);
  });

  it("keeps registration separate and permits only a source reference", () => {
    const registration = { format: "flarex.core-application.registration", version: 1,
      requestKey: "register-1", sourceArtifactRootSha256: "b".repeat(64) };
    expect(Result.isSuccess(decodeCoreApplicationRegistrationRequest(registration))).toBe(true);
    expect(Result.isFailure(decodeCoreApplicationRegistrationRequest({ ...registration, manifest: {} }))).toBe(true);
    expect(Result.isFailure(decodeCoreApplicationInvocationRequest(registration))).toBe(true);
  });

  it("distinguishes an authoritative Core profile from an explicit legacy profile", () => {
    const core = { format: "flarex.core-application.profile", version: 1, kind: "core", route,
      sourceArtifactRootSha256: "c".repeat(64), sourcePackageHash: "d".repeat(64) };
    expect(Result.isSuccess(decodeCoreApplicationProfile(core))).toBe(true);
    expect(Result.isFailure(decodeCoreApplicationProfile({ ...core, sourcePackageHash: undefined }))).toBe(true);
    expect(Result.isSuccess(decodeCoreApplicationProfile({ format: "flarex.core-application.profile", version: 1,
      kind: "legacy", deploymentId: route.deploymentId }))).toBe(true);
  });
});
