import { expect } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { and, eq } from "drizzle-orm";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { defineCmsCommand, makeCmsHost } from "../src/cmsTransaction/host";
import { fxSystemIdempotency } from "../src/schema";
import { fxSystemDataBindingCandidates } from "../src/frameworkSchema/binding/schema";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0EmptyMutationReference } from "./ce0EmptyMutationReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export async function ce0EmptyMutationReferenceScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  const reference = await runEffect(
    makeCe0EmptyMutationReference(tested.input),
  );
  const core = (key: string, args: { count: number; prefix: string }) =>
    tested.host.run(key, tested.insert, args);
  const counts = () => [tested.executionCount(), reference.executionCount()];
  const initial = await tested.inventory();
  const seed = await runEffect(
    core(tested.host.newRequestKey(), { count: 1, prefix: "occupied" }),
  );
  await tested.verifyInsert(initial, seed, 1, "occupied");
  const args = { count: 0, prefix: "empty" };
  // Each implementation must authenticate and replay the other's exact bytes.
  // This would fail even for two [] results if either identity recipe drifted.
  for (const run of [core, reference.run]) {
    const before = await tested.inventory();
    const key = tested.host.newRequestKey();
    expect(await runEffect(run(key, args))).toEqual([]);
    const after = await tested.verifyInsert(before, [], 0, args.prefix);
    const executed = counts();
    for (const replay of [core, reference.run]) {
      expect(await runEffect(replay(key, args))).toEqual([]);
      expect(
        await runEffectFailure(replay(key, { ...args, prefix: "other-input" })),
      ).toMatchObject({ reason: "requestConflict" });
    }
    const policy = {
      ...tested.input,
      identityAndAccessPolicy: { subject: "other-subject" },
    };
    const otherCore = await runEffect(makeCmsHost(policy));
    const otherReference = await runEffect(
      makeCe0EmptyMutationReference(policy),
    );
    expect(
      await runEffectFailure(otherCore.run(key, tested.insert, args)),
    ).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(otherReference.run(key, args))).toMatchObject(
      { reason: "requestConflict" },
    );
    expect(otherReference.executionCount()).toBe(0);
    expect(counts()).toEqual(executed);
    expect(await tested.inventory()).toEqual(after);

    const outcome = after.outcomes.find((row) => row.requestKey === key);
    if (outcome === undefined || outcome.resultSha256 === null)
      throw new Error("Expected available outcome");
    const selected = and(
      eq(fxSystemIdempotency.scopeUuid, tested.scope.scopeUuid),
      eq(fxSystemIdempotency.requestKey, outcome.requestKey),
    );
    const damaged = new Uint8Array(outcome.resultSha256);
    damaged[0] = (damaged[0] ?? 0) ^ 1;
    await persistence.drizzle
      .update(fxSystemIdempotency)
      .set({ resultSha256: damaged })
      .where(selected);
    try {
      const corrupt = await tested.inventory();
      for (const replay of [core, reference.run])
        expect(await runEffectFailure(replay(key, args))).toMatchObject({
          reason: "storedCorruption",
        });
      expect(await tested.inventory()).toEqual(corrupt);
    } finally {
      await persistence.drizzle
        .update(fxSystemIdempotency)
        .set(outcome)
        .where(selected);
    }
    await persistence.drizzle
      .update(fxSystemIdempotency)
      .set({
        resultState: "expired",
        resultValueCodecVersion: null,
        resultSemanticBytes: null,
        resultBytes: null,
        resultSha256: null,
        resultExpiredAt: new Date(
          Math.max(Date.now(), outcome.createdAt.getTime()),
        ),
      })
      .where(selected);
    try {
      const expired = await tested.inventory();
      for (const replay of [core, reference.run])
        expect(await runEffectFailure(replay(key, args))).toMatchObject({
          reason: "resultUnavailable",
        });
      expect(await tested.inventory()).toEqual(expired);
    } finally {
      await persistence.drizzle
        .update(fxSystemIdempotency)
        .set(outcome)
        .where(selected);
    }
    expect(counts()).toEqual(executed);
  }

  const otherOperation = defineCmsCommand({
    name: "otherEmptyOperation",
    mode: "write",
    run: () => Effect.succeed([]),
  });
  const otherHost = await runEffect(
    makeCmsHost({ ...tested.input, commands: [otherOperation] }),
  );
  const operationKey = tested.host.newRequestKey();
  await runEffect(otherHost.run(operationKey, otherOperation, args));
  const beforeRefusal = await tested.inventory();
  const beforeCounts = counts();
  for (const run of [core, reference.run]) {
    expect(await runEffectFailure(run(operationKey, args))).toMatchObject({
      reason: "requestConflict",
    });
    expect(
      await runEffectFailure(
        run(tested.host.newRequestKey(), {
          ...args,
          prefix: "x".repeat(400_000),
        }),
      ),
    ).toMatchObject({ reason: "limitExceeded" });
  }
  expect(
    await runEffectFailure(
      reference.run(tested.host.newRequestKey(), {
        count: 1,
        prefix: "unsupported",
      }),
    ),
  ).toMatchObject({ reason: "unsupportedProfile" });
  expect(counts()).toEqual(beforeCounts);
  expect(await tested.inventory()).toEqual(beforeRefusal);

  // Real stored binding corruption must refuse both fresh execution and replay.
  const candidates = await persistence.drizzle
    .select()
    .from(fxSystemDataBindingCandidates)
    .where(
      eq(
        fxSystemDataBindingCandidates.scopeId,
        tested.fixture.authority.scopeId,
      ),
    );
  const candidate = candidates[0];
  if (candidate === undefined || candidates.length !== 1)
    throw new Error("Expected one binding candidate");
  const candidateSlot = and(
    eq(fxSystemDataBindingCandidates.scopeId, candidate.scopeId),
    eq(
      fxSystemDataBindingCandidates.storageGeneration,
      candidate.storageGeneration,
    ),
    eq(fxSystemDataBindingCandidates.sha256, candidate.sha256),
  );
  const bytes = new Uint8Array(candidate.canonicalBytes);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  await persistence.drizzle
    .update(fxSystemDataBindingCandidates)
    .set({ canonicalBytes: bytes })
    .where(candidateSlot);
  try {
    for (const run of [core, reference.run])
      for (const key of [operationKey, tested.host.newRequestKey()]) {
        // Binding repository failures are projected by the CMS host as invalid
        // authority; outcome corruption above has its own storedCorruption class.
        expect(await runEffectFailure(run(key, args))).toMatchObject({
          reason: "invalidAuthority",
        });
      }
    expect(counts()).toEqual(beforeCounts);
    expect(await tested.inventory()).toEqual(beforeRefusal);
  } finally {
    await persistence.drizzle
      .update(fxSystemDataBindingCandidates)
      .set({ canonicalBytes: candidate.canonicalBytes })
      .where(candidateSlot);
  }

  for (const failedStep of [
    "commitHeaderWritten",
    "outcomeWritten",
    "wakeWritten",
    "clockAdvanced",
  ] as const) {
    const fault = new Error(`Failure after ${failedStep}`);
    const injected = {
      ...tested.input,
      materialization: {
        ...tested.input.materialization,
        afterTransactionStep: async (event: { readonly step: string }) => {
          if (event.step === failedStep) throw fault;
        },
      },
    };
    const failedCore = await runEffect(makeCmsHost(injected));
    const failedReference = await runEffect(
      makeCe0EmptyMutationReference(injected),
    );
    for (const run of [
      (key: string) => failedCore.run(key, tested.insert, args),
      (key: string) => failedReference.run(key, args),
    ]) {
      const before = await tested.inventory();
      const key = tested.host.newRequestKey();
      const failure = await runEffect(Effect.exit(run(key)));
      expect(Exit.isFailure(failure)).toBe(true);
      if (Exit.isFailure(failure))
        expect(
          failure.cause.reasons
            .filter(Cause.isDieReason)
            .map((reason) => reason.defect),
        ).toContain(fault);
      expect(await tested.inventory()).toEqual(before);
      // Confirmed rollback permits a new ordinary invocation with this same key.
      expect(await runEffect(reference.run(key, args))).toEqual([]);
      const after = await tested.verifyInsert(before, [], 0, args.prefix);
      const executed = counts();
      expect(await runEffect(core(key, args))).toEqual([]);
      expect(counts()).toEqual(executed);
      expect(await tested.inventory()).toEqual(after);
    }
  }
  return { tested, reference, args };
}
