import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../../../src/application/applicationActivationSchema";
import type { ApplicationActiveCasToken } from "../../../src/application/activation/contracts";
import { ApplicationActivationError } from "../../../src/application/activation/errors";
import { makeApplicationActivationRepository } from "../../../src/application/activation/repository";
import {
  fxControlScopes,
  fxControlScopeProvisioning,
  fxSystemApplicationReadinessV1,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../../src/database/schema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities } from "../support/readinessPreparation";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

const token = (): ApplicationActiveCasToken => ({ activationSequence: 1n, headSha256: "a".repeat(64) });

describe("Application activation CAS token capture", { timeout: 30_000 }, () => {
  it("refuses malformed own descriptors without getters or authority work, retains reflection causes, then activates", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const snapshot = async () => ({
      activations: await fixture.target.drizzle.select().from(fxSystemApplicationActivations),
      heads: await fixture.target.drizzle.select().from(fxSystemApplicationActiveHeads),
      readiness: await fixture.target.drizzle.select().from(fxSystemApplicationReadinessV1),
      clocks: await fixture.target.drizzle.select().from(fxSystemScopeClocks),
      executionAuthorities: await fixture.target.drizzle.select().from(fxSystemScopeExecutionAuthorities),
      placement: await fixture.control.drizzle.select().from(fxControlScopes),
      provisioning: await fixture.control.drizzle.select().from(fxControlScopeProvisioning),
      materializations: fixture.materializationCount(),
    });
    const before = await snapshot();
    let sequenceGetterCalls = 0;
    let digestGetterCalls = 0;
    let proxyGetCalls = 0;
    const sequenceGetterCause = new Error("CAS sequence getter must not execute");
    const digestGetterCause = new Error("CAS digest getter must not execute");
    const proxyGetCause = new Error("CAS property reads must use own descriptors");
    const ownKeysCause = new Error("Foreign ownKeys failed");
    const descriptorsCause = new Error("Foreign own descriptor inspection failed");
    const missingDigest = token();
    Reflect.deleteProperty(missingDigest, "headSha256");
    const inheritedSequence = token();
    Reflect.deleteProperty(inheritedSequence, "activationSequence");
    Object.setPrototypeOf(inheritedSequence, { activationSequence: 1n });
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly value: ApplicationActiveCasToken;
      readonly foreignCause?: Error;
    }> = [
      { label: "zero sequence", value: { ...token(), activationSequence: 0n } },
      { label: "negative sequence", value: { ...token(), activationSequence: -1n } },
      { label: "sequence above int64 maximum", value: { ...token(), activationSequence: 9_223_372_036_854_775_808n } },
      { label: "uppercase digest", value: { ...token(), headSha256: "A".repeat(64) } },
      { label: "short digest", value: { ...token(), headSha256: "a".repeat(63) } },
      { label: "long digest", value: { ...token(), headSha256: "a".repeat(65) } },
      { label: "nonhex digest", value: { ...token(), headSha256: "g".repeat(64) } },
      { label: "missing own digest", value: missingDigest },
      { label: "inherited sequence", value: inheritedSequence },
      { label: "extra string key", value: Object.assign(token(), { unexpected: true }) },
      { label: "extra symbol key", value: Object.assign(token(), { [Symbol("foreign CAS key")]: true }) },
      { label: "array token", value: Object.assign([], token()) },
      { label: "nonenumerable sequence", value: Object.defineProperty(token(), "activationSequence", { enumerable: false }) },
      { label: "nonenumerable digest", value: Object.defineProperty(token(), "headSha256", { enumerable: false }) },
      { label: "sequence accessor", value: Object.defineProperty(token(), "activationSequence", {
        enumerable: true, get() { sequenceGetterCalls++; throw sequenceGetterCause; },
      }) },
      { label: "digest accessor", value: Object.defineProperty(token(), "headSha256", {
        enumerable: true, get() { digestGetterCalls++; throw digestGetterCause; },
      }) },
      { label: "proxy property reads avoided", value: new Proxy({ ...token(), headSha256: "g".repeat(64) }, {
        get() { proxyGetCalls++; throw proxyGetCause; },
      }) },
      { label: "proxy ownKeys failure", value: new Proxy(token(), {
        ownKeys() { throw ownKeysCause; },
      }), foreignCause: ownKeysCause },
      { label: "proxy descriptor failure", value: new Proxy(token(), {
        getOwnPropertyDescriptor() { throw descriptorsCause; },
      }), foreignCause: descriptorsCause },
    ];

    const controlTransaction = vi.spyOn(fixture.control.drizzle, "transaction");
    const targetTransaction = vi.spyOn(fixture.target.drizzle, "transaction");
    const resolveTarget = vi.spyOn(fixture.authorityPorts.scopeClockTargets, "resolve");
    try {
      for (const specimen of cases) {
        const failure = await runEffectFailure(activation.activate({
          revisionId: fixture.input.revisionId,
          expectedActiveHead: specimen.value,
        }));
        expect(failure, specimen.label).toBeInstanceOf(ApplicationActivationError);
        expect(failure, specimen.label).toMatchObject({
          operation: "activate", reason: "invalidInput", revisionId: fixture.input.revisionId, retryable: false,
        });
        if (specimen.foreignCause !== undefined) expect(failure.cause, specimen.label).toBe(specimen.foreignCause);
        else expect(failure.cause, specimen.label).toMatchObject({ message: "invalid token" });
        expect(sequenceGetterCalls, specimen.label).toBe(0);
        expect(digestGetterCalls, specimen.label).toBe(0);
        expect(proxyGetCalls, specimen.label).toBe(0);
        expect(controlTransaction, specimen.label).not.toHaveBeenCalled();
        expect(targetTransaction, specimen.label).not.toHaveBeenCalled();
        expect(resolveTarget, specimen.label).not.toHaveBeenCalled();
      }
    } finally {
      controlTransaction.mockRestore();
      targetTransaction.mockRestore();
      resolveTarget.mockRestore();
    }
    expect(await snapshot()).toEqual(before);

    const valid = await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    expect(valid).toMatchObject({ disposition: "inserted", revisionId: fixture.input.revisionId });
    const after = await snapshot();
    expect(after.activations).toHaveLength(before.activations.length + 1);
    expect(after.heads).toHaveLength(1);
    expect(after.heads[0]).toMatchObject({ revisionId: fixture.input.revisionId, activationSequence: valid.activationSequence });
  });
});
