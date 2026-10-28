import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { captureWorkflowResourceDigest } from "../src/workflow/configuration";

describe("bounded canonical workflow resource identity", () => {
  const resources = { resources: [{ name: "customer", module: "customer", profile: "customer.read", methods: [{ name: "read", command: { name: "read", mode: "read" } }],
    graph: { aliases: [{ name: "customer", model: "Customer" }], reads: [{ model: "Customer", table: { name: "customer", columns: ["id"] } }] }, expose: false }],
    composedResources: [{ name: "link", dependencies: [{ participant: "links", command: { name: "create" } }], identity: { routing: "customer-account" } }] };
  it("covers methods, profiles, graph fields, exposure and composed Link dependencies deterministically", async () => {
    const baseline = await Effect.runPromise(captureWorkflowResourceDigest(resources));
    expect(baseline).toMatch(/^[a-f0-9]{64}$/);
    expect(await Effect.runPromise(captureWorkflowResourceDigest(structuredClone(resources)))).toBe(baseline);
    const reordered = { composedResources: resources.composedResources, resources: resources.resources };
    expect(await Effect.runPromise(captureWorkflowResourceDigest(reordered))).toBe(baseline);
    const original = resources.resources[0], link = resources.composedResources[0];
    if (original === undefined || link === undefined) throw new Error("Missing neutral resource identity");
    const mutations = [
      { ...original, name: "other" }, { ...original, module: "other" }, { ...original, profile: "customer.write" },
      { ...original, methods: [] }, { ...original, graph: { ...original.graph, reads: [] } }, { ...original, expose: true },
    ];
    for (const resource of mutations)
      expect(await Effect.runPromise(captureWorkflowResourceDigest({ ...resources, resources: [resource] }))).not.toBe(baseline);
    for (const composed of [{ ...link, dependencies: [] }, { ...link, identity: { routing: "foreign" } }])
      expect(await Effect.runPromise(captureWorkflowResourceDigest({ ...resources, composedResources: [composed] }))).not.toBe(baseline);
  });
  it("retains byte, depth, descriptor and Unicode refusals plus canonical number rules", async () => {
    let getters = 0, deep: unknown = null;
    for (let index = 0; index < 65; index++) deep = { child: deep };
    const accessor = Object.defineProperty({}, "hidden", { enumerable: true, get: () => { getters++; return null; } });
    for (const invalid of [{ bytes: "x".repeat(65_536) }, deep])
      expect(await Effect.runPromise(Effect.result(captureWorkflowResourceDigest(invalid))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    for (const invalid of [accessor, { unicode: "\ud800" }, { value: Number.NaN }])
      expect(await Effect.runPromise(Effect.result(captureWorkflowResourceDigest(invalid))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(getters).toBe(0);
    expect(await Effect.runPromise(captureWorkflowResourceDigest({ value: -0 })))
      .toBe(await Effect.runPromise(captureWorkflowResourceDigest({ value: 0 })));
  });
  it("detaches the proof before asynchronous hashing and preserves hash failures", async () => {
    const input = structuredClone(resources), expected = await Effect.runPromise(captureWorkflowResourceDigest(input));
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((...args) => {
      input.resources.splice(0); return digest(...args);
    });
    try { expect(await Effect.runPromise(captureWorkflowResourceDigest(input))).toBe(expected); }
    finally { spy.mockRestore(); }
    const failure = new Error("hash unavailable"), rejected = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(failure);
    try {
      expect(await Effect.runPromise(Effect.result(captureWorkflowResourceDigest(resources))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: failure } });
    } finally { rejected.mockRestore(); }
  });
});
