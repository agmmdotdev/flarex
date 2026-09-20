import { expect } from "vitest";
import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { MAX_ORDERED_INDEX_KEY_BYTES_V1 } from "flarex-protocol/ordered-index";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { cmsLimits } from "../src/cmsTransaction/model";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { decodeReadDocuments } from "./ce0CmsReadReferenceScenario";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
  const mutation = await runEffect(makeCe0CmsMutationReference(input));
  const core = (key: string, args: { count: number; prefix: string }) =>
    coreHost.run(key, tested.insert, args);
  const mutations = [
    { name: "core", run: core, count: tested.executionCount },
    { name: "reference", run: mutation.run, count: mutation.executionCount },
  ];

  for (const engine of mutations) {
    const args = { count: 32, prefix: prefix(`small-${engine.name}`, 1000) };
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
