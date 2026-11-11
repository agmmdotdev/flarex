import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { createStep, createWorkflow, nativeCartCreationProfile, nativeCartMutationProfile, StepResponse, WorkflowResponse } from "../src/index";

const step = createStep("profile-node", () => new StepResponse(null));
const stages = (count: number) => () => {
  for (let index = 0; index < count; index++) step(undefined).config({ name: "node-" + index });
  return new WorkflowResponse(null);
};
const selected = (name: string, count: number) => createWorkflow({ name, constructionProfile: nativeCartCreationProfile }, stages(count));

describe("closed native Cart construction profile", () => {
  it("retains the default64-node boundary and admits only the selected73-node boundary", () => {
    expect(Result.getOrThrow(createWorkflow("ordinary-64", stages(64)).prepare()).nodeCount).toBe(64);
    expect(() => createWorkflow("ordinary-65", stages(65))).toThrow("Too many workflow nodes");
    expect(Result.getOrThrow(selected("cart-73", 73).prepare()).nodeCount).toBe(73);
    expect(() => selected("cart-74", 74)).toThrow("Too many workflow nodes");
  });

  it("counts real child closures and does not inherit a child's larger allowance", () => {
    const child = selected("cart-child-72", 72);
    expect(Result.getOrThrow(child.prepare()).nodeCount).toBe(72);
    expect(() => createWorkflow("ordinary-cart-wrapper", () => new WorkflowResponse(child.runAsStep({ input: undefined }))))
      .toThrow("Too many workflow nodes");
    const wrapper = createWorkflow({ name: "selected-cart-wrapper", constructionProfile: nativeCartCreationProfile }, () =>
      new WorkflowResponse(child.runAsStep({ input: undefined })));
    expect(Result.getOrThrow(wrapper.prepare()).nodeCount).toBe(73);
    expect(() => createWorkflow({ name: "too-large-cart-wrapper", constructionProfile: nativeCartCreationProfile }, () => {
      step(undefined); return new WorkflowResponse(child.runAsStep({ input: undefined }));
    })).toThrow("Too many workflow nodes");
    const small = selected("small-selected-child", 1);
    const ordinary = createWorkflow("small-ordinary-parent", () => new WorkflowResponse(small.runAsStep({ input: undefined })));
    expect(Result.getOrThrow(ordinary.prepare()).identity).not.toHaveProperty("constructionProfile");
  });

  it("charges declared callback children to the same aggregate ceiling without changing their grammar", () => {
    const child = createWorkflow("callback-default-64", stages(64));
    const callback = createStep({ name: "declared-callback", invokedWorkflows: [child] }, () => new StepResponse(null));
    const build = (count: number) => () => {
      for (let index = 0; index < count; index++) step(undefined).config({ name: "local-" + index });
      return new WorkflowResponse(callback(undefined));
    };
    expect(Result.getOrThrow(createWorkflow({ name: "callback-73", constructionProfile: nativeCartCreationProfile }, build(8)).prepare()).nodeCount).toBe(73);
    expect(() => createWorkflow({ name: "callback-74", constructionProfile: nativeCartCreationProfile }, build(9)))
      .toThrow("Too many workflow nodes");
    const tooManyChildren = Array.from({ length: 65 }, (_, index) => createWorkflow("empty-child-" + index, () => new WorkflowResponse(null)));
    expect(() => createStep({ name: "too-many-callback-children", invokedWorkflows: tooManyChildren }, () => new StepResponse(null)))
      .toThrow("Invalid callback child closure");
    expect(() => Reflect.apply(createStep, undefined, [{ name: "invalid-step-options", constructionProfile: nativeCartCreationProfile }, () => new StepResponse(null)]))
      .toThrow("Invalid finite step options");
  });

  it("refuses clones, foreign markers, request-shaped limits and unsupported combinations before composition", () => {
    let composed = 0, getters = 0;
    const accessor = Object.defineProperty({ name: "profile-getter" }, "constructionProfile", {
      enumerable: true, get() { getters++; return nativeCartCreationProfile; },
    });
    for (const declaration of [accessor,
      { name: "profile-clone", constructionProfile: { ...nativeCartCreationProfile } },
      { name: "profile-foreign", constructionProfile: { profile: "nativeCartCreation", maximumNodes: 73 } },
      { name: "profile-json-limit", nodeLimit: 73 },
      { name: "profile-node-limit", constructionProfile: nativeCartCreationProfile, nodeLimit: 73 },
      { name: "profile-idempotent", constructionProfile: nativeCartCreationProfile, idempotent: false },
      { name: "profile-store", constructionProfile: nativeCartCreationProfile, store: true, retentionTime: 259200 },
      { name: "profile-undefined", constructionProfile: undefined },
    ]) expect(() => Reflect.apply(createWorkflow, undefined, [declaration, () => { composed++; return new WorkflowResponse(null); }])).toThrow();
    expect(composed).toBe(0); expect(getters).toBe(0);
    expect(Object.isFrozen(nativeCartCreationProfile)).toBe(true);
    expect(Reflect.ownKeys(nativeCartCreationProfile)).toEqual(["profile"]);
  });

  it("captures caller options and identity while preserving ordinary canonical bytes", () => {
    const plain = Result.getOrThrow(createWorkflow("profile-identity", stages(1)).prepare());
    expect(JSON.stringify(plain.identity)).toBe('{"name":"profile-identity","nodes":[{"name":"node-0","kind":"step","guards":[],"input":{"absent":true},"hook":false,"bound":false}],"references":[],"result":null}');
    const options = { name: "profile-identity", constructionProfile: nativeCartCreationProfile };
    const workflow = createWorkflow(options, stages(1));
    options.name = "caller-mutated-name"; options.constructionProfile = { ...nativeCartCreationProfile };
    const prepared = Result.getOrThrow(workflow.prepare());
    expect(prepared.identity.name).toBe("profile-identity");
    expect(prepared.identity.constructionProfile).toEqual({ profile: "nativeCartCreation", maximumNodes: 73 });
    expect(prepared.identity).not.toEqual(plain.identity);
    expect(Object.isFrozen(prepared.identity.constructionProfile)).toBe(true);
    expect(() => Reflect.apply(createWorkflow, undefined, [{ name: "identity-is-not-authority", constructionProfile: prepared.identity.constructionProfile }, stages(1)]))
      .toThrow("Only the issued native Cart construction profile is admitted");
  });
});

describe("closed native Cart mutation construction profile", () => {
  it("admits exactly the issued243-node boundary and retains native idempotent:false in identity", () => {
    const prepared = Result.getOrThrow(createWorkflow({ name: "mutation-243", constructionProfile: nativeCartMutationProfile,
      idempotent: false }, stages(243)).prepare());
    expect(prepared.nodeCount).toBe(243);
    expect(prepared.identity).toMatchObject({ idempotent: false,
      constructionProfile: { profile: "nativeCartMutation", maximumNodes: 243 } });
    expect(Object.isFrozen(prepared.identity.constructionProfile)).toBe(true);
    expect(() => createWorkflow({ name: "mutation-244", constructionProfile: nativeCartMutationProfile }, stages(244)))
      .toThrow("Too many workflow nodes");
    expect(() => Reflect.apply(createWorkflow, undefined, [{ name: "mutation-identity-is-not-authority",
      constructionProfile: prepared.identity.constructionProfile }, stages(1)])).toThrow();
  });

  it("counts the complete child closure without granting a parent a child's allowance", () => {
    const child = createWorkflow({ name: "mutation-child-242", constructionProfile: nativeCartMutationProfile }, stages(242));
    expect(() => createWorkflow("ordinary-mutation-wrapper", () => new WorkflowResponse(child.runAsStep({ input: undefined }))))
      .toThrow("Too many workflow nodes");
    expect(() => createWorkflow({ name: "creation-mutation-wrapper", constructionProfile: nativeCartCreationProfile }, () =>
      new WorkflowResponse(child.runAsStep({ input: undefined })))).toThrow("Too many workflow nodes");
    const wrapper = createWorkflow({ name: "mutation-wrapper-243", constructionProfile: nativeCartMutationProfile }, () =>
      new WorkflowResponse(child.runAsStep({ input: undefined })));
    expect(Result.getOrThrow(wrapper.prepare()).nodeCount).toBe(243);
    expect(() => createWorkflow({ name: "mutation-wrapper-244", constructionProfile: nativeCartMutationProfile }, () => {
      step(undefined); return new WorkflowResponse(child.runAsStep({ input: undefined }));
    })).toThrow("Too many workflow nodes");
    const small = createWorkflow({ name: "small-mutation-child", constructionProfile: nativeCartMutationProfile, idempotent: false }, stages(1));
    const ordinary = Result.getOrThrow(createWorkflow("small-mutation-parent", () =>
      new WorkflowResponse(small.runAsStep({ input: undefined }))).prepare());
    expect(ordinary.identity).not.toHaveProperty("constructionProfile");
    expect(ordinary.identity).not.toHaveProperty("idempotent");
  });

  it("charges declared callback children against the selected mutation ceiling", () => {
    const child = createWorkflow({ name: "callback-mutation-child", constructionProfile: nativeCartMutationProfile }, stages(234));
    const callback = createStep({ name: "mutation-declared-callback", invokedWorkflows: [child] }, () => new StepResponse(null));
    const build = (count: number) => () => {
      for (let index = 0; index < count; index++) step(undefined).config({ name: "mutation-local-" + index });
      return new WorkflowResponse(callback(undefined));
    };
    expect(Result.getOrThrow(createWorkflow({ name: "mutation-callback-243", constructionProfile: nativeCartMutationProfile }, build(8)).prepare()).nodeCount).toBe(243);
    expect(() => createWorkflow({ name: "mutation-callback-244", constructionProfile: nativeCartMutationProfile }, build(9)))
      .toThrow("Too many workflow nodes");
  });

  it("rejects forged, accessor, JSON and unsupported declarations before composition", () => {
    let composed = 0, getters = 0;
    const accessor = Object.defineProperty({ name: "mutation-profile-getter" }, "constructionProfile", {
      enumerable: true, get() { getters++; return nativeCartMutationProfile; },
    });
    const idempotencyAccessor = Object.defineProperty({ name: "mutation-idempotency-getter", constructionProfile: nativeCartMutationProfile }, "idempotent", {
      enumerable: true, get() { getters++; return false; },
    });
    for (const declaration of [accessor, idempotencyAccessor,
      { name: "mutation-clone", constructionProfile: { ...nativeCartMutationProfile } },
      { name: "mutation-json", constructionProfile: JSON.parse(JSON.stringify(nativeCartMutationProfile)) },
      { name: "mutation-limit", nodeLimit: 243 },
      { name: "mutation-profile-limit", constructionProfile: nativeCartMutationProfile, nodeLimit: 243 },
      { name: "mutation-idempotent-true", constructionProfile: nativeCartMutationProfile, idempotent: true },
      { name: "mutation-idempotent-undefined", constructionProfile: nativeCartMutationProfile, idempotent: undefined },
      { name: "mutation-store", constructionProfile: nativeCartMutationProfile, idempotent: false, store: true, retentionTime: 259200 },
    ]) expect(() => Reflect.apply(createWorkflow, undefined, [declaration, () => { composed++; return new WorkflowResponse(null); }])).toThrow();
    expect(composed).toBe(0); expect(getters).toBe(0);
    expect(Object.isFrozen(nativeCartMutationProfile)).toBe(true);
    expect(Reflect.ownKeys(nativeCartMutationProfile)).toEqual(["profile"]);
  });
});
