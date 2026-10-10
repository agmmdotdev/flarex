import { Effect, Exit, Scope } from "effect";
import { expect, it } from "vitest";
import { makeApplicationServing, type ApplicationReadServing } from "../../../src/application/applicationServing";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../../../src/database/locatedTransactionIdentity";
import { makePreparedHostRuntime } from "../../../src/execution/preparation/preparedHostRuntime";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { bindCmsCommand, bindCmsRead, makeCmsCommandBinding, makeCmsReadBinding,
  type CmsCommandBinding, type CmsReadBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { runEffect } from "../../support/effectTestRuntime";
import { cmsHostFixture } from "./cmsHostFixture";

const identity = Object.freeze({ configSha256: "1".repeat(64), provenanceSha256: "2".repeat(64) });

it("refuses forged command and read bindings before host preparation", async () => {
  // SAFETY: deliberately forged capability identities prove the issuer check.
  const commandBinding = Object.freeze({}) as CmsCommandBinding;
  // SAFETY: deliberately forged capability identities prove the issuer check.
  const readBinding = Object.freeze({}) as CmsReadBinding;
  expect(await runEffect(Effect.flip(bindCmsCommand(commandBinding, [], identity))))
    .toMatchObject({ reason: "invalidAuthority" });
  expect(await runEffect(Effect.flip(bindCmsRead(readBinding, [], identity))))
    .toMatchObject({ reason: "invalidAuthority" });
});

it("binds authentic serving and drains hosts when its serving Scope closes", async () => {
  const resource = await createRelationalPGliteFixture();
  const { fixture } = await cmsHostFixture(resource.persistence);
  if (!isLocatedReadCommittedAttemptTargetV1(fixture.pointTarget)) throw new Error("Expected located read target");
  const target = fixture.pointTarget;
  if (fixture.relation.binding.version !== 3) throw new Error("Expected owned write policy");
  const claim = fixture.relation.binding.writePolicies.find(policy => policy.owner === "payload");
  if (claim === undefined || claim.owner !== "payload") throw new Error("Expected Payload content policy");
  const contentIdentity = Object.freeze({ configSha256: claim.configSha256, provenanceSha256: claim.provenanceSha256 });
  let calls = 0;
  const read = defineCmsCommand({ name: "bindingRead", mode: "read", run: () => Effect.sync(() => { calls++; return null; }) });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 2_097_152 });
    const servingScope = yield* Scope.make();
    const bindingScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(bindingScope, Exit.succeed(undefined)));
    yield* Effect.addFinalizer(() => Scope.close(servingScope, Exit.succeed(undefined)));
    const servingInput = Object.freeze({ database: resource.persistence.drizzle, controlDatabase: fixture.control.drizzle,
      target, session: resource.session, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      activation: fixture.activationProfile,
      cold: Object.freeze({ runtimeHostIdentity: "flarex.test/application-relation-runtime-host", compatibilityDate: "2026-08-25",
        materialize: () => Effect.die("Binding construction must not materialize installation state") }) });
    const serving = yield* makeApplicationServing(servingInput).pipe(Scope.provide(servingScope));
    const binding = yield* makeCmsCommandBinding({ serving, hostRuntime, identityAndAccessPolicy: { subject: "cms-binding-test" },
      profile: { kind: "fullProof" } }).pipe(Scope.provide(bindingScope));
    const host = yield* bindCmsCommand(binding, [read], contentIdentity);
    expect(yield* host.read(read, null)).toBeNull();
    expect(calls).toBe(1);
    expect(yield* Effect.flip(bindCmsCommand({ ...binding }, [read], contentIdentity)))
      .toMatchObject({ reason: "invalidAuthority" });
    // SAFETY: a deliberate cross-kind presentation proves distinct issuers.
    const presentedAsRead = binding as unknown as CmsReadBinding;
    expect(yield* Effect.flip(bindCmsRead(presentedAsRead, [read], contentIdentity)))
      .toMatchObject({ reason: "invalidAuthority" });
    // SAFETY: deliberately present command authority as a read token to prove
    // that only the exact separate read issuer grants read binding authority.
    const forgedReadServing = serving as unknown as ApplicationReadServing;
    expect(yield* Effect.flip(makeCmsReadBinding({ serving: forgedReadServing, hostRuntime, identityAndAccessPolicy: {},
      schemaVersionId: fixture.relation.binding.schemaVersionId,
      source: { sourceKey: "payload", sourceSha256: "3".repeat(64), writeProfile: "payload.scalar" } })))
      .toMatchObject({ reason: "invalidAuthority" });
    yield* Scope.close(servingScope, Exit.succeed(undefined));
    expect(yield* Effect.flip(host.read(read, null))).toMatchObject({ reason: "closed" });
    expect(yield* Effect.flip(bindCmsCommand(binding, [read], contentIdentity))).toMatchObject({ reason: "closed" });
    expect(calls).toBe(1);
    // The still-open binding Scope must not retain the dead serving's host
    // reservation. A new serving generation can take the exact sole lease.
    const replacement = yield* makeApplicationServing(servingInput);
    const next = yield* makeCmsCommandBinding({ serving: replacement, hostRuntime,
      identityAndAccessPolicy: { subject: "cms-binding-test" }, profile: { kind: "fullProof" } });
    const nextHost = yield* bindCmsCommand(next, [read], contentIdentity);
    expect(yield* nextHost.read(read, null)).toBeNull();
    expect(calls).toBe(2);
  })));
}, 180_000);
