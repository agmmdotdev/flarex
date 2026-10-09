import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { eq } from "drizzle-orm";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { prepareNeutralCommerceProfile } from "./neutralCommerceProfile";
import { registerLocalCommerceProfile, requireCommerceProfile, registerCommerceSchemaProfile, type CommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import { defineCommerceCommand, makeLocalCommerceHost, type LocalCommerceEventPolicy } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeCommerceBinding } from "../../../src/frameworks/commerceTransaction/commerce";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { fxSystemDataBindingPhysicalLanes } from "../../../src/installation/frameworkSchema/binding/schema";
import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";
import { captureBindingValue, isDataBindingSetFrame } from "../../../src/installation/frameworkSchema/binding/canonical";
import { commerceInventory } from "./commerceInventory";
import { defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants, prepareAtomicCommerceParticipants } from "../../../src/frameworks/atomicCommerce/participants";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid profile binding test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
const names = ["alpha", "beta", "gamma"] as const;
const commands = names.map(name => ({ name,
  read: defineCommerceCommand(`read-${name}`, "read", Effect.fn(function* (ctx) {
    const table = yield* ctx.table(name);
    return [...yield* table.find(ctx.manager, { fields: ["id", "value"], take: 10, order: { column: "id", direction: "asc" } })];
  })),
  write: defineCommerceCommand(`write-${name}`, "write", Effect.fn(function* (ctx) {
    const table = yield* ctx.table(name);
    return [...yield* table.write(ctx.manager, "insert", [{ id: name, value: 1 }])];
  })),
}));
const registeredCommands = commands.flatMap(value => [value.read, value.write]);
const events: LocalCommerceEventPolicy = {
  capture: () => Effect.fail(commerceError("unadmittedEvent")),
  validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
  deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
};

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture();
    registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepareNeutralCommerceProfile(names), registeredCommands, control, () => events);
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

describe("module-neutral installation profile membership", () => {
  it("authenticates every member, confines three hosts and revokes an existing host without changing core", async () => {
    const { artifact, layout } = fixture.descriptor;
    const profiles = await Promise.all(names.map(name => runEffect(registerLocalCommerceProfile(artifact, layout, `test.${name}`,
      [{ tableId: name, keyId: `${name}.primary` }]))));
    const hosts = await Promise.all(profiles.map(profile => runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile, commands: registeredCommands }, events))));
    const members = await runEffect(prepareAtomicCommerceParticipants(fixture.persistence.drizzle, fixture.cms.target,
      Result.getOrThrow(captureAtomicCommerceParticipants(profiles.slice(0, 2).map((profile, index) => ({ participant: defineAtomicCommerceParticipant(`independent${index}`),
        profile, installation: fixture.installation, commands: registeredCommands, validate: events.validate })))), undefined, { kind: "standalone" }));
    expect(members).toHaveLength(2);
    expect(members[0]?.prepared).toBe(members[1]?.prepared);
    const beta = hosts[1]; const betaCommand = commands[1];
    if (beta === undefined || betaCommand === undefined) throw new Error("Missing beta fixture");
    expect(await runEffectFailure(beta.host.read(betaCommand.read, {}))).toMatchObject({ reason: "unsupportedProfile" });
    const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
    expect(await runEffect(makeCommerceBinding(fixture.availability, [...profiles].reverse()))).toEqual(binding);
    expect(Object.isFrozen(binding.profiles[0])).toBe(true);
    expect(binding.profiles.map(value => value.profileId)).toEqual(names.map(name => `test.${name}`));
    const frame = { ...fixture.candidate.frame, commerce: [binding] };
    expect(await runEffectFailure(fixture.bindings.prepare(frame))).toMatchObject({ reason: "unsupportedProfile" });
    const bindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: profiles }));
    const candidate = await runEffect(bindings.prepare(frame));
    const current = await runEffect(fixture.bindings.withCurrent(readAdmittedDataBinding));
    const request = dataBindingActivationRequest(frame.application.scopeId, frame.application.storageGeneration, "three-profiles", candidate.sha256, current.head);
    expect(await runEffectFailure(fixture.bindings.activate(request))).toMatchObject({ reason: "unsupportedProfile" });
    await runEffect(bindings.activate(request));
    expect(await runEffect(bindings.recover(request))).toMatchObject({ current: { _tag: "Success", success: { selected: true } } });
    expect(await runEffectFailure(fixture.bindings.withCurrent(readAdmittedDataBinding))).toMatchObject({ reason: "unsupportedProfile" });
    const lanes = await fixture.persistence.drizzle.select().from(fxSystemDataBindingPhysicalLanes).where(eq(fxSystemDataBindingPhysicalLanes.candidateSha256, candidate.sha256));
    expect(lanes).toHaveLength(1);
    const before = await commerceInventory(fixture);
    for (const [index, command] of commands.entries()) {
      const host = hosts[index]?.host;
      if (host === undefined) throw new Error("Missing independent host");
      const key = host.newRequestKey();
      const result = await runEffect(host.run(key, command.write, {}));
      expect(await runEffect(host.run(key, command.write, {}))).toEqual(result);
      expect(await runEffect(host.read(command.read, {}))).toEqual([{ id: command.name, value: 1 }]);
      for (const other of commands.filter(value => value !== command)) {
        expect(await runEffectFailure(host.read(other.read, {}))).toMatchObject({ reason: "invalidAuthority" });
        expect(await runEffectFailure(host.run(host.newRequestKey(), other.write, {}))).toMatchObject({ reason: "invalidAuthority" });
      }
    }
    const after = await commerceInventory(fixture);
    expect(after.commits.length - before.commits.length).toBe(3);
    expect(after.facts.length - before.facts.length).toBe(3);
    const selected = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
    const reduced = await runEffect(makeCommerceBinding(fixture.availability, profiles.filter((_value, index) => index !== 1)));
    const revocation = await runEffect(bindings.prepare({ ...frame, commerce: [reduced] }));
    const withdrawn = await runEffect(bindings.activate(dataBindingActivationRequest(frame.application.scopeId,
      frame.application.storageGeneration, "revoke-beta", revocation.sha256, selected.head)));
    const withdrawnCurrent = Result.getOrThrow(withdrawn.current);
    expect(withdrawnCurrent.selected).toBe(true);
    expect(withdrawn.receipt.frame.version).toBe(3);
    if (withdrawn.receipt.frame.version !== 3) throw new Error("Missing accepted withdrawal epoch");
    const [authority] = await fixture.persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
      .where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.cms.fixture.authority.scopeId));
    if (authority === undefined) throw new Error("Missing actual withdrawal authority");
    expect(withdrawn.receipt.frame.authorizationRevocationEpoch).toBe(authority.authorizationRevocationEpoch.toString());
    expect(BigInt(withdrawn.receipt.frame.authorizationRevocationEpoch)).toBe(BigInt(frame.application.authorizationRevocationEpoch) + 1n);
    // The candidate retains the proposal's authentic pre-withdrawal reference.
    expect(revocation.frame.application).toEqual(frame.application);
    expect((await runEffect(bindings.withCurrent(readAdmittedDataBinding))).head).toEqual(withdrawnCurrent.head);
    expect((await runEffect(bindings.recover(withdrawn.receipt.frame.request))).receipt).toEqual(withdrawn.receipt);
    // The receipt can authorize current admission, never a new proposal from
    // the old observed epoch, even with an otherwise current CAS token.
    expect(await runEffectFailure(bindings.activate(dataBindingActivationRequest(frame.application.scopeId,
      frame.application.storageGeneration, "stale-withdrawal-proposal", revocation.sha256, withdrawnCurrent.head))))
      .toMatchObject({ reason: "staleApplication" });
    expect(await runEffectFailure(beta.host.read(betaCommand.read, {}))).toMatchObject({ reason: "unsupportedProfile" });
    const remaining = hosts[0]; const remainingCommand = commands[0]; const remainingProfile = profiles[0];
    const withdrawnProfile = profiles[1];
    if (remaining === undefined || remainingCommand === undefined || remainingProfile === undefined || withdrawnProfile === undefined)
      throw new Error("Missing retained profile fixture");
    // Physical hosts retain installation evidence and reauthenticate the
    // Application and selected membership on every request.
    expect(await runEffect(remaining.host.read(remainingCommand.read, {}))).toEqual([{ id: "alpha", value: 1 }]);
    const freshRemaining = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile: remainingProfile,
      commands: registeredCommands }, events));
    const freshWithdrawn = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile: withdrawnProfile,
      commands: registeredCommands }, events));
    cleanup.push(() => runEffect(freshRemaining.host.close), () => runEffect(freshWithdrawn.host.close));
    expect(await runEffect(freshRemaining.host.read(remainingCommand.read, {}))).toEqual([{ id: "alpha", value: 1 }]);
    expect(await runEffectFailure(freshWithdrawn.host.read(betaCommand.read, {}))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await commerceInventory(fixture)).toEqual(after);
    // A separate live revocation is not the selected receipt's accepted epoch.
    await fixture.persistence.drizzle.transaction(tx => runEffect(
      advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.cms.fixture.authority.scopeId)));
    expect(await runEffectFailure(bindings.withCurrent(readAdmittedDataBinding))).toMatchObject({ reason: "staleApplication" });
    expect(await runEffectFailure(remaining.host.read(remainingCommand.read, {}))).toMatchObject({ reason: "bindingChanged" });
    expect(await runEffectFailure(freshRemaining.host.read(remainingCommand.read, {}))).toMatchObject({ reason: "bindingChanged" });
  }, 120000);

  it("rejects conflicting grants, malformed direct references and old triplets", async () => {
    const { artifact, layout } = fixture.descriptor;
    const overlap = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.overlap", [{ tableId: "alpha", keyId: "alpha.primary" }]));
    expect(await runEffectFailure(makeCommerceBinding(fixture.availability, [fixture.prepared.profile, overlap]))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(makeCommerceBinding(fixture.availability, [fixture.prepared.profile, fixture.prepared.profile]))).toMatchObject({ reason: "unsupportedProfile" });
    const binding = await runEffect(makeCommerceBinding(fixture.availability, [fixture.prepared.profile]));
    const schemaOnly = await runEffect(registerCommerceSchemaProfile(artifact, layout));
    // SAFETY: deliberately wrong nominal family proves the schema issuer grants no execution authority.
    expect(await runEffectFailure(makeCommerceBinding(fixture.availability, [schemaOnly as unknown as CommerceProfile]))).toMatchObject({ reason: "unsupportedProfile" });
    const descriptor = await runEffect(requireCommerceProfile(fixture.prepared.profile));
    const currentApplication = await runEffect(fixture.bindings.readApplicationReference());
    const currentFrame = { ...fixture.candidate.frame, application: currentApplication,
      payloadContent: fixture.candidate.frame.payloadContent === null ? null :
        { ...fixture.candidate.frame.payloadContent, application: currentApplication } };
    expect(isDataBindingSetFrame(currentFrame)).toBe(true);
    expect(await runEffectFailure(fixture.bindings.prepare({ ...fixture.candidate.frame, application: currentApplication,
      commerce: [binding] }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(fixture.bindings.prepare({ ...currentFrame, commerce: [{ ...binding,
      profiles: [{ profileId: descriptor.profileId, contractSha256: "f".repeat(64) }] }] }))).toMatchObject({ reason: "unsupportedProfile" });
    const eight = Array.from({ length: 8 }, (_value, index) => ({ profileId: `test.p${index}`, contractSha256: descriptor.contractSha256 }));
    expect(isDataBindingSetFrame({ ...fixture.candidate.frame, commerce: [{ ...binding, profiles: eight }] })).toBe(true);
    expect(isDataBindingSetFrame({ ...fixture.candidate.frame, commerce: [{ ...binding, profiles: [...eight, { profileId: "test.p8", contractSha256: descriptor.contractSha256 }] }] })).toBe(false);
    const first = { ...binding, installation: { ...binding.installation, installationSha256: "0".repeat(64) }, profiles: eight };
    const second = { ...binding, installation: { ...binding.installation, installationSha256: "f".repeat(64) } };
    expect(isDataBindingSetFrame({ ...fixture.candidate.frame, commerce: [first, second] })).toBe(false);
    const ordered = [{ ...first, profiles: binding.profiles }, second];
    expect(isDataBindingSetFrame({ ...fixture.candidate.frame, commerce: ordered })).toBe(true);
    for (const commerce of [ordered.toReversed(), [ordered[0], ordered[0]],
      Array.from({ length: 9 }, (_value, index) => ({ ...binding,
        installation: { ...binding.installation, installationSha256: index.toString(16).repeat(64) } }))]) {
      expect(await runEffectFailure(captureBindingValue({ ...fixture.candidate.frame, commerce }, isDataBindingSetFrame)))
        .toMatchObject({ reason: "invalidInput" });
    }
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "profileId", { enumerable: true, get: () => { getterCalls++; return descriptor.profileId; } });
    for (const malformed of [
      { ...binding, profiles: [] },
      { ...binding, profiles: [binding.profiles[0], binding.profiles[0]] },
      { ...binding, availabilitySequence: "not-an-integer" },
      { ...binding, profiles: [accessor] },
      { ...binding, profiles: [...eight].reverse() },
      { ...binding, profiles: ["adapter", "query", "store"].map(kind => ({ kind, profileId: `${descriptor.profileId}.${kind}`, contractSha256: descriptor.contractSha256, coverage: [] })) },
    ]) {
      expect(await runEffectFailure(captureBindingValue({ ...fixture.candidate.frame, commerce: [malformed] }, isDataBindingSetFrame))).toMatchObject({ reason: "invalidInput" });
    }
    expect(getterCalls).toBe(0);
  });
});
