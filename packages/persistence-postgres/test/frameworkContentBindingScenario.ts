import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect } from "vitest";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makeFrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import type { DataBindingSetFrame, PayloadContentBinding } from "../src/frameworkSchema/binding/model";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { fxSystemDataBindingCandidates, fxSystemDataBindingHeads, fxSystemDataBindingActivations } from "../src/frameworkSchema/binding/schema";
import { fxSystemApplicationWriteOwnership } from "../src/applicationWriteOwnership/Schema";
import { fxSystemScopeClocks, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes,
  fxAppRowCurrent, fxSystemTransactionSessions } from "../src/schema";
import { relationReadinessFixture, prepareReadinessEvidence, prepareAdditionalRelationRevision } from "./applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** One activated Application and one shared contract for both drivers. */
export async function frameworkContentBindingScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const fixture = await relationReadinessFixture({ persistence, writePolicy: true, bindingAdmission: true });
  await prepareReadinessEvidence(fixture);
  expect((await runEffect(fixture.fold.settle(fixture.input))).status).toBe("ready");
  await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const targetInput = {
    deploymentId: fixture.deploymentId,
    canonicalPhysicalDatabaseIdentity: "content-binding-fixture",
    physicalLocator: active.basis.authority.physicalLocator,
  };
  const target = await runEffect(makeFrameworkSchemaTarget({ ...targetInput, database: persistence.drizzle }));
  const input = { database: persistence.drizzle, deploymentId: fixture.deploymentId,
    target, authority: fixture.authorityPorts, application: fixture.relationActivation };
  const host = await runEffect(makeDataBindingHost(input));
  const reference = await runEffect(host.readApplicationReference());
  expect(reference.readiness).toMatchObject({ kind: "policy", relationCount: 0 });
  const binding = fixture.relation.binding;
  if (binding.version !== 3) throw new Error("Expected the authenticated V3 binding");
  const claims = binding.writePolicies.filter(policy => policy.owner === "payload");
  const first = claims[0];
  if (first?.owner !== "payload") throw new Error("Expected a managed policy");
  const content: PayloadContentBinding = { configSha256: first.configSha256, provenanceSha256: first.provenanceSha256,
    application: reference, tables: claims.map(policy => ({ tableId: policy.tableId.toString(), writePolicySha256: policy.writePolicySha256 })) };
  const frame: DataBindingSetFrame = { format: "flarex.data-binding-set", application: reference,
    payloadContent: content, payloadLifecycle: null, commerce: [], crossDomainReferences: [] };
  const inventory = async () => ({
    clock: await persistence.drizzle.select().from(fxSystemScopeClocks),
    rows: await persistence.drizzle.select().from(fxAppRowCurrent),
    commits: await persistence.drizzle.select().from(fxSystemCommits),
    outcomes: await persistence.drizzle.select().from(fxSystemIdempotency),
    wakes: await persistence.drizzle.select().from(fxSystemCommitWakes),
    sessions: await persistence.drizzle.select().from(fxSystemTransactionSessions),
  });
  const before = await inventory();
  const candidate = await runEffect(host.prepare(frame));
  expect(await runEffect(host.prepare(frame))).toEqual(candidate);
  const request = dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "content-binding-activate", candidate.sha256, null);
  const activated = await runEffect(host.activate(request));
  expect(Result.getOrThrow(activated.current).selected).toBe(true);
  expect(await runEffect(host.recover(request))).toEqual(activated);
  expect((await runEffect(host.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  const reopened = await runEffect(makeDataBindingHost(input));
  expect((await runEffect(reopened.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  const escaped = await runEffect(host.withCurrent(selection => Effect.succeed(selection)));
  expect(await runEffectFailure(readAdmittedDataBinding(escaped))).toMatchObject({ reason: "invalidAuthority" });

  const reject = async (payloadContent: PayloadContentBinding) => {
    expect(await runEffectFailure(host.prepare({ ...frame, payloadContent }))).toMatchObject({ reason: "invalidAuthority" });
  };
  await reject({ ...content, configSha256: "0".repeat(64) });
  await reject({ ...content, provenanceSha256: "0".repeat(64) });
  await reject({ ...content, tables: [] });
  await reject({ ...content, tables: content.tables.map(table => ({ ...table, writePolicySha256: "0".repeat(64) })) });
  const ordinary = binding.tables.find(table => table.logicalName === "audit");
  if (ordinary === undefined) throw new Error("Expected ordinary Application table");
  await reject({ ...content, tables: [{ tableId: ordinary.tableId.toString(), writePolicySha256: first.writePolicySha256 }] });
  await reject({ ...content, tables: [...content.tables, { tableId: ordinary.tableId.toString(), writePolicySha256: first.writePolicySha256 }] });
  await reject({ ...content, tables: [{ tableId: `0${first.tableId}`, writePolicySha256: first.writePolicySha256 }] });
  expect(await runEffectFailure(host.prepare({ ...frame, payloadContent: {
    ...content, application: { ...reference, headSha256: "0".repeat(64) },
  } }))).toMatchObject({ reason: "invalidInput" });

  // Corruption of retained ownership after activation must invalidate selection.
  const condition = and(eq(fxSystemApplicationWriteOwnership.scopeId, fixture.authority.scopeId),
    eq(fxSystemApplicationWriteOwnership.activationSequence, 1n));
  const [retained] = await persistence.drizzle.select().from(fxSystemApplicationWriteOwnership).where(condition);
  if (retained === undefined) throw new Error("Expected retained ownership");
  const corrupt = Uint8Array.from(retained.claimsBytes);
  corrupt[0] = 32;
  await persistence.drizzle.update(fxSystemApplicationWriteOwnership).set({ claimsBytes: corrupt }).where(condition);
  expect(Result.isFailure(await runEffect(host.withCurrent(readAdmittedDataBinding).pipe(Effect.result)))).toBe(true);
  await persistence.drizzle.update(fxSystemApplicationWriteOwnership).set({ claimsBytes: retained.claimsBytes }).where(condition);
  expect((await runEffect(host.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  expect(await inventory()).toEqual(before);
  expect(await persistence.drizzle.select().from(fxSystemDataBindingCandidates)).toHaveLength(1);
  expect(await persistence.drizzle.select().from(fxSystemDataBindingHeads)).toHaveLength(1);
  expect(await persistence.drizzle.select().from(fxSystemDataBindingActivations)).toHaveLength(1);

  const previous = await runEffect(fixture.relationActivation.readActive());
  const next = await prepareAdditionalRelationRevision(fixture, 2);
  await runEffect(fixture.relationActivation.activate({ revisionId: next.publication.revisionId,
    expectedActiveHead: previous.expectedActiveHead }));
  expect(await runEffectFailure(host.withCurrent(readAdmittedDataBinding))).toMatchObject({ reason: "staleApplication" });
  expect((await runEffect(host.recover(request))).current).toMatchObject({ _tag: "Failure", failure: { reason: "staleApplication" } });
  const nextReference = await runEffect(host.readApplicationReference());
  const updated = await runEffect(host.prepare({ ...frame, application: nextReference,
    payloadContent: { ...content, application: nextReference } }));
  const replacement = await runEffect(host.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "content-binding-replace", updated.sha256, Result.getOrThrow(activated.current).head)));
  expect(Result.getOrThrow(replacement.current).selected).toBe(true);
  expect((await runEffect(host.withCurrent(readAdmittedDataBinding))).frame.application).toEqual(nextReference);
}
