import { Cause, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { describeFailure, FailureEvidenceSchema } from "./failure";

describe("safe ordered measurement failure evidence", () => {
  it("preserves every actual Effect reason, including repeated identical payloads", () => {
    const repeated = { _tag: "ValidationError", reason: "invalidInput", input: "private-input" };
    const cause = Cause.fromReasons([
      Cause.makeFailReason(repeated), Cause.makeDieReason(new Error("private-defect")),
      Cause.makeInterruptReason(42), Cause.makeFailReason(repeated),
    ]);
    const evidence = describeFailure("request", cause);
    expect(evidence.outcome).toBe("mixed");
    expect(evidence.truncated).toBe(false);
    expect(evidence.reasons).toEqual([
      { kind: "fail", index: 0, reasonPath: ["effect", 0], tokens: ["Fail", "ValidationError", "invalidInput"] },
      { kind: "die", index: 1, reasonPath: ["effect", 1], tokens: ["Die", "Error"] },
      { kind: "interrupt", index: 2, reasonPath: ["effect", 2], tokens: ["Interrupt"] },
      { kind: "fail", index: 3, reasonPath: ["effect", 3], tokens: ["Fail", "ValidationError", "invalidInput"] },
    ]);
    expect(Schema.is(FailureEvidenceSchema)(evidence)).toBe(true);
  });

  it.each([
    [Cause.fail({ _tag: "DomainError" }), "typedFailure", "fail"],
    [Cause.die({ _tag: "InvariantDefect" }), "defect", "die"],
    [Cause.interrupt(12), "interruption", "interrupt"],
  ])("classifies a single actual Cause category", (cause, outcome, kind) => {
    const evidence = describeFailure("request", cause);
    expect(evidence.outcome).toBe(outcome);
    expect(evidence.reasons[0]?.kind).toBe(kind);
  });

  it("keeps tagged and untagged Promise rejections foreign rather than inventing typed failures", () => {
    const ordinary = describeFailure("verification", new Error("credentials must stay private"));
    expect(ordinary).toMatchObject({ stage: "verification", outcome: "foreign", truncated: false,
      reasons: [{ kind: "foreign", index: 0, reasonPath: [], tokens: ["Error"] }] });
    const tagged = describeFailure("cleanup", { _tag: "CleanupError", reason: "closeFailed" });
    expect(tagged.outcome).toBe("foreign");
    expect(tagged.reasons[0]?.tokens).toEqual(["CleanupError", "closeFailed"]);
    expect(describeFailure("request", undefined).outcome).toBe("unknown");
    expect(describeFailure("request", Cause.empty).outcome).toBe("unknown");
  });

  it("flattens known nested AggregateErrors in primary then cleanup order", () => {
    const primary = Cause.fail({ _tag: "RequestRejected" });
    const cleanup = Cause.die({ _tag: "CleanupDefect" });
    const foreign = new Error("private cleanup message");
    const combined = new AggregateError([primary, new AggregateError([cleanup, foreign], "private inner")], "private outer");
    const evidence = describeFailure("commandCleanup", combined);
    expect(evidence.outcome).toBe("mixed");
    expect(evidence.reasons.map(reason => ({ kind: reason.kind, index: reason.index, path: reason.reasonPath }))).toEqual([
      { kind: "fail", index: 0, path: ["aggregate", 0, "effect", 0] },
      { kind: "die", index: 1, path: ["aggregate", 1, "aggregate", 0, "effect", 0] },
      { kind: "foreign", index: 2, path: ["aggregate", 1, "aggregate", 1] },
    ]);
    expect(evidence.truncated).toBe(false);
    expect(describeFailure("request", new AggregateError([primary, primary])).reasons).toHaveLength(2);
  });

  it("retains safe tags while excluding arbitrary messages, stacks, SQL, inputs and credentials", () => {
    const secret = "postgres://admin:private-password@example.test/db";
    const error = Object.assign(new Error(secret), { _tag: "DatabaseError", code: "resourceFailure",
      input: { password: secret }, sql: "SELECT private-password", detail: secret, reason: secret });
    error.stack = secret;
    const evidence = describeFailure("request", Cause.fail(error));
    expect(evidence.reasons[0]?.tokens).toEqual(["Fail", "Error", "DatabaseError", "resourceFailure"]);
    const retained = JSON.stringify(evidence);
    expect(retained).not.toContain("private-password");
    expect(retained).not.toContain("SELECT");
    expect(retained).not.toContain("example.test");
    expect(describeFailure(secret, error).stage).toBe("unknownStage");
  });

  it("bounds cycles, recursive foreign causes and wide failures with explicit uncertainty", () => {
    const recursive: { _tag: string; cause?: unknown } = { _tag: "RecursiveFailure" };
    recursive.cause = recursive;
    const cycle = describeFailure("request", recursive);
    expect(cycle.truncated).toBe(true);
    expect(cycle.outcome).toBe("unknown");
    expect(cycle.reasons[0]?.kind).toBe("foreign");
    let deep: unknown = new Error("private deepest cause");
    for (let index = 0; index < 1000; index++) deep = { _tag: "ForeignWrapper", cause: deep };
    const depth = describeFailure("cleanup", deep);
    expect(depth.truncated).toBe(true);
    expect(depth.outcome).toBe("unknown");
    expect(depth.reasons.length).toBeLessThanOrEqual(17);
    const wide = describeFailure("request", Cause.fromReasons(Array.from({ length: 1000 }, () => Cause.makeFailReason({ _tag: "RepeatedFailure" }))));
    expect(wide.truncated).toBe(true);
    expect(wide.outcome).toBe("unknown");
    expect(wide.reasons).toHaveLength(128);
    expect(Schema.is(FailureEvidenceSchema)(wide)).toBe(true);
    const primitiveArray = describeFailure("request", { _tag: "ForeignWrapper", errors: Array.from({ length: 1000 }, () => "private") });
    expect(primitiveArray.truncated).toBe(true);
    expect(JSON.stringify(primitiveArray)).not.toContain("private");
  });

  it("does not invoke foreign accessors or let inspection traps replace the original failure", () => {
    let reads = 0;
    const accessor = Object.defineProperty({ _tag: "ForeignFailure" }, "cause", { get() { reads++; throw new Error("private getter"); } });
    const evidence = describeFailure("request", accessor);
    expect(reads).toBe(0);
    expect(evidence.outcome).toBe("unknown");
    expect(evidence.truncated).toBe(true);
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("private proxy trap"); },
      has() { throw new Error("private proxy trap"); } });
    expect(() => describeFailure("request", proxy)).not.toThrow();
    expect(describeFailure("request", proxy)).toMatchObject({ outcome: "unknown", truncated: true });
  });

  it("captures foreign array lengths once without invoking Proxy get traps", () => {
    let directLengthReads = 0;
    const descriptorReads: string[] = [];
    const proxyArray = <A>(values: A[]) => new Proxy(values, {
      get(target, key, receiver) {
        if (key === "length") { directLengthReads++; throw new Error("Direct foreign length access"); }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        descriptorReads.push(String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const aggregate = new AggregateError([]);
    Object.defineProperty(aggregate, "errors", { value: proxyArray([new Error("private-message")]) });
    expect(describeFailure("cleanup", aggregate)).toMatchObject({ outcome: "foreign", truncated: false,
      reasons: [{ kind: "foreign", reasonPath: ["aggregate", 0], tokens: ["Error"] }] });
    expect(directLengthReads).toBe(0);
    expect(descriptorReads.filter(key => key === "length")).toHaveLength(1);
    descriptorReads.length = 0;
    const cause = Cause.fromReasons([]);
    Object.defineProperty(cause, "reasons", { value: proxyArray([Cause.makeFailReason({ _tag: "DomainFailure" })]) });
    expect(describeFailure("request", cause)).toMatchObject({ outcome: "typedFailure", truncated: false,
      reasons: [{ kind: "fail", reasonPath: ["effect", 0], tokens: ["Fail", "DomainFailure"] }] });
    expect(directLengthReads).toBe(0);
    expect(descriptorReads.filter(key => key === "length")).toHaveLength(1);
  });

  it.each([-1, 0.5, Infinity])("marks an invalid captured foreign array length %s unavailable", length => {
    const aggregate = new AggregateError([]);
    Object.defineProperty(aggregate, "errors", { value: new Proxy([], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "length" ? { ...descriptor, value: length } : descriptor;
      },
    }) });
    expect(describeFailure("cleanup", aggregate)).toMatchObject({ outcome: "unknown", truncated: true });
  });
});
