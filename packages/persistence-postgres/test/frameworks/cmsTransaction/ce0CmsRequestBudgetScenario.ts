import { expect } from "vitest";
import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { MAX_ORDERED_INDEX_KEY_BYTES_V1 } from "flarex-protocol/ordered-index";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { cmsLimits } from "../../../src/frameworks/cmsTransaction/model";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { decodeReadDocuments } from "./ce0CmsReadReferenceScenario";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

/** Legal indexed strings whose JSON escaping stresses cumulative capture work. */
const prefix = (label: string, length: number) =>
  `${label}-${"\u0001".repeat(length)}`;

export async function ce0CmsRequestBudgetScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  let materializationSteps = 0;
  const input = {
    ...tested.input,
    materialization: {
      ...tested.input.materialization,
      afterTransactionStep: async () => {
        materializationSteps++;
      },
    },
  };
  const coreHost = await runEffect(makeCmsHost(input));
  // Trusted selections are captured, aggregate across operations, and bind replay.
  const selected = { calls: 2, commandBytes: cmsLimits.commandBytes };
  const selectedHost = await runEffect(makeCmsHost({ ...input, requestBudget: selected }));
  selected.calls = 64;
  expect(selectedHost.requestBudget.calls).toBe(2);
  expect(Object.isFrozen(selectedHost.requestBudget)).toBe(true);
  const selectionBefore = await tested.inventory();
  const selectedKey = selectedHost.newRequestKey();
  const selectedArgs = { count: 1, prefix: "selected-budget" };
  expect(await runEffectFailure(selectedHost.run(selectedKey, tested.insert, { ...selectedArgs, count: 8 })))
    .toMatchObject({ reason: "limitExceeded" });
  expect(await tested.inventory()).toEqual(selectionBefore);
  const selectedValue = await runEffect(selectedHost.run(selectedKey, tested.insert, selectedArgs));
  await tested.verifyInsert(selectionBefore, selectedValue, 1, selectedArgs.prefix);
  const callsAfterSelection = tested.executionCount();
  expect(await runEffect(selectedHost.run(selectedKey, tested.insert, selectedArgs))).toEqual(selectedValue);
  expect(await runEffectFailure(coreHost.run(selectedKey, tested.insert, selectedArgs)))
    .toMatchObject({ reason: "requestConflict" });
  const changedHost = await runEffect(makeCmsHost({ ...input, requestBudget: { calls: 3, commandBytes: cmsLimits.commandBytes } }));
  expect(await runEffectFailure(changedHost.run(selectedKey, tested.insert, selectedArgs)))
    .toMatchObject({ reason: "requestConflict" });
  // Old arbitrary policy objects cannot impersonate the new selection domain.
  const lookalike = await runEffect(makeCmsHost({ ...input, identityAndAccessPolicy: {
    policy: input.identityAndAccessPolicy, requestBudget: selectedHost.requestBudget,
  } }));
  expect(await runEffectFailure(lookalike.run(selectedKey, tested.insert, selectedArgs)))
    .toMatchObject({ reason: "requestConflict" });
  expect(tested.executionCount()).toBe(callsAfterSelection);
  const byteHost = await runEffect(makeCmsHost({ ...input, requestBudget: { calls: 64, commandBytes: 4096 } }));
  const beforeBytes = await tested.inventory();
  expect(await runEffectFailure(byteHost.run(byteHost.newRequestKey(), tested.insert,
    { count: 8, prefix: "b".repeat(1500) }))).toMatchObject({ reason: "limitExceeded" });
  expect(await tested.inventory()).toEqual(beforeBytes);
  for (const invalid of [0, 1.5, Number.NaN, cmsLimits.calls + 1]) {
    expect(await runEffectFailure(makeCmsHost({ ...input, requestBudget: { calls: invalid, commandBytes: cmsLimits.commandBytes } })))
      .toMatchObject({ reason: "unsupportedProfile" });
  }
  for (const host of [selectedHost, changedHost, lookalike, byteHost]) await runEffect(host.close);
  const mutation = await runEffect(makeCe0CmsMutationReference(input));
  const core = (key: string, args: { count: number; prefix: string }) =>
    coreHost.run(key, tested.insert, args);
  const mutations = [
    { name: "core", run: core, count: tested.executionCount },
    { name: "reference", run: mutation.run, count: mutation.executionCount },
  ];

  for (const engine of mutations) {
    // Complete read/unique observations now consume the same request budget.
    // Keep a comfortably admitted sample and the existing overflowing sample.
    const args = { count: 32, prefix: prefix(`small-${engine.name}`, 900) };
    const before = await tested.inventory();
    const key = tested.host.newRequestKey();
    const callbacks = engine.count();
    materializationSteps = 0;
    const value = await runEffect(engine.run(key, args));
    expect(engine.count()).toBe(callbacks + 1);
    expect(materializationSteps).toBeGreaterThan(0);
    const after = await tested.verifyInsert(before, value, 32, args.prefix);
    // The large result is replayed, not charged as a new execution.
    const counts = mutations.map((item) => item.count());
    for (const replay of mutations) {
      expect(await runEffect(replay.run(key, args))).toEqual(value);
      expect(mutations.map((item) => item.count())).toEqual(counts);
      expect(await tested.inventory()).toEqual(after);
    }

    const refused = { count: 32, prefix: prefix(`large-${engine.name}`, 1200) };
    const refusedKey = tested.host.newRequestKey();
    const beforeRefusal = await tested.inventory();
    const beforeCalls = engine.count();
    materializationSteps = 0;
    expect(
      await runEffectFailure(engine.run(refusedKey, refused)),
    ).toMatchObject({ reason: "limitExceeded" });
    expect(engine.count()).toBe(beforeCalls + 1);
    expect(materializationSteps).toBe(0);
    expect(await tested.inventory()).toEqual(beforeRefusal);

    // The same title and key succeed in a smaller, explicit request after the
    // confirmed rollback. This also proves the individual document/key is legal.
    const corrected = { ...refused, count: 1 };
    const correctedValue = await runEffect(engine.run(refusedKey, corrected));
    expect(engine.count()).toBe(beforeCalls + 2);
    expect(materializationSteps).toBeGreaterThan(0);
    const correctedState = await tested.verifyInsert(
      beforeRefusal,
      correctedValue,
      1,
      corrected.prefix,
    );
    const correctedDocument = decodeReadDocuments(correctedValue)[0];
    if (correctedDocument === undefined)
      throw new Error("Missing corrected insert document");
    // All generated suffixes have equal width. Even a 32-row result of this
    // shape fits the single-value limit: accumulated request work caused refusal.
    const largeResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect(
        Array.from({ length: 32 }, () => correctedDocument),
      ),
    );
    expect(largeResult.canonicalBytes.byteLength).toBeLessThan(
      cmsLimits.commandBytes,
    );
    const correctedCounts = mutations.map((item) => item.count());
    for (const replay of mutations) {
      expect(await runEffect(replay.run(refusedKey, corrected))).toEqual(
        correctedValue,
      );
      expect(mutations.map((item) => item.count())).toEqual(correctedCounts);
      expect(await tested.inventory()).toEqual(correctedState);
    }
  }

  // Build legal larger rows through actual smaller commands. A large read must
  // account for every returned copy even when all IDs name one cached identity.
  const seeded: Json[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const args = { count: 8, prefix: prefix(`read-${batch}`, 1800) };
    const before = await tested.inventory();
    const value = await runEffect(core(tested.host.newRequestKey(), args));
    await tested.verifyInsert(before, value, 8, args.prefix);
    seeded.push(...decodeReadDocuments(value));
  }
  const documents = decodeReadDocuments(seeded);
  const first = documents[0];
  if (first === undefined) throw new Error("Missing budget read seed");
  const stable = await tested.inventory();
  for (const revision of stable.revisions) {
    expect(revision.valueBytes?.byteLength).toBeLessThan(
      cmsLimits.documentBytes,
    );
  }
  for (const membership of stable.indexes) {
    expect(membership.encodedKey.byteLength).toBeLessThanOrEqual(
      MAX_ORDERED_INDEX_KEY_BYTES_V1,
    );
  }
  let reads = 0;
  const hooks = {
    documentReads: {
      beforeRead: () =>
        Effect.sync(() => {
          reads++;
        }),
    },
  };
  const readCore = await runEffect(makeCmsHost(tested.input, hooks));
  const readReference = await runEffect(
    makeCe0CmsReadReference(tested.input, hooks),
  );
  const readEngines = [
    {
      read: (ids: string[]) => readCore.read(tested.read, ids),
      count: tested.readExecutionCount,
    },
    { read: readReference.read, count: readReference.executionCount },
  ];
  for (const repeated of [false, true]) {
    const successCount = repeated ? 31 : 23;
    for (const count of [successCount, successCount + 1]) {
      const expected = repeated
        ? Array.from({ length: count }, () => first)
        : documents.slice(0, count);
      const ids = expected.map((document) => document._id);
      expect(ids).toHaveLength(count);
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect(expected),
      );
      expect(result.canonicalBytes.byteLength).toBeLessThan(
        cmsLimits.commandBytes,
      );
      for (const engine of readEngines) {
        const beforeCalls = engine.count();
        reads = 0;
        if (count === successCount) {
          expect(await runEffect(engine.read(ids))).toEqual(expected);
        } else {
          expect(await runEffectFailure(engine.read(ids))).toMatchObject({
            reason: "limitExceeded",
          });
        }
        expect(engine.count()).toBe(beforeCalls + 1);
        expect(reads).toBe(repeated ? 1 : count);
        expect(await tested.inventory()).toEqual(stable);
      }
    }
  }
}
