import { expect, vi } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { cmsLimits } from "../src/cmsTransaction/model";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export async function ce0CmsPendingUniqueScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  let steps = 0;
  const input = {
    ...tested.input,
    materialization: {
      ...tested.input.materialization,
      afterTransactionStep: async () => {
        steps++;
      },
    },
  };
  const host = await runEffect(makeCmsHost(input));
  const reference = await runEffect(makeCe0CmsMutationReference(input));
  const engines = [
    {
      name: "core",
      run: (key: string, args: Json) => host.run(key, tested.insert, args),
      count: tested.executionCount,
      invalid: "invalidInput",
    },
    {
      name: "reference",
      run: reference.run,
      count: reference.executionCount,
      invalid: "unsupportedProfile",
    },
  ];
  const seedTitles = ["committed-duplicate"];
  const beforeSeed = await tested.inventory();
  const seed = await runEffect(
    host.run(host.newRequestKey(), tested.insert, { titles: seedTitles }),
  );
  await tested.verifyInserts(beforeSeed, [{ value: seed, titles: seedTitles }]);
  expect(steps).toBeGreaterThan(0);

  const late = Array.from({ length: 31 }, (_, index) => `pending-${index}`);
  const cases = [
    { titles: ["early", "early"], attempts: 2 },
    { titles: [...late, "pending-0"], attempts: 32 },
    { titles: ["", ""], attempts: 2 },
    { titles: ["fresh", "committed-duplicate"], attempts: 2 },
    {
      titles: [
        "first-failure",
        "first-failure",
        "x".repeat(cmsLimits.documentBytes + 1),
      ],
      attempts: 2,
    },
  ];
  for (const engine of engines) {
    for (const [index, example] of cases.entries()) {
      const before = await tested.inventory();
      const key = host.newRequestKey();
      const count = engine.count();
      steps = 0;
      // Observe actual identity allocation without changing its implementation.
      // This distinguishes eager execution from command-level pre-deduplication.
      const random = vi.spyOn(crypto, "getRandomValues");
      try {
        expect(
          await runEffectFailure(engine.run(key, { titles: example.titles })),
        ).toMatchObject({
          reason: "uniqueConflict",
          uniqueConstraint: { tableName: "posts", orderedFields: ["title"] },
        });
        expect(random).toHaveBeenCalledTimes(example.attempts);
      } finally {
        random.mockRestore();
      }
      expect(engine.count()).toBe(count + 1);
      expect(steps).toBe(0);
      expect(await tested.inventory()).toEqual(before);
      const titles = [`corrected-${engine.name}-${index}`];
      const corrected = await runEffect(engine.run(key, { titles }));
      const after = await tested.verifyInserts(before, [
        { value: corrected, titles },
      ]);
      expect(engine.count()).toBe(count + 2);
      expect(steps).toBeGreaterThan(0);
      const counts = engines.map((item) => item.count());
      for (const replay of engines) {
        expect(await runEffect(replay.run(key, { titles }))).toEqual(corrected);
        expect(engines.map((item) => item.count())).toEqual(counts);
        expect(await tested.inventory()).toEqual(after);
      }
    }

    for (const count of [0, 1, 2, 8, 32]) {
      const prefix = `explicit-${engine.name}-${count}`;
      const titles = Array.from(
        { length: count },
        (_, index) => `${prefix}-${index.toString().padStart(2, "0")}`,
      );
      const key = host.newRequestKey();
      const before = await tested.inventory();
      const value = await runEffect(engine.run(key, { titles }));
      const after = await tested.verifyInserts(before, [{ value, titles }]);
      const counts = engines.map((item) => item.count());
      for (const replay of engines) {
        expect(await runEffect(replay.run(key, { titles }))).toEqual(value);
        // Equal generated output is not equal request identity.
        if (count !== 2) {
          expect(
            await runEffectFailure(replay.run(key, { count, prefix })),
          ).toMatchObject({ reason: "requestConflict" });
        }
        if (count > 1) {
          expect(
            await runEffectFailure(
              replay.run(key, { titles: titles.toReversed() }),
            ),
          ).toMatchObject({ reason: "requestConflict" });
        }
        expect(engines.map((item) => item.count())).toEqual(counts);
        expect(await tested.inventory()).toEqual(after);
      }
    }
    // The reference refuses inputs outside its admitted profile explicitly;
    // the actual command reports invalidInput. Neither reaches its callback.
    for (const args of [
      { titles: Array.from({ length: 33 }, (_, index) => `too-many-${index}`) },
      { titles: [1] },
      { titles: [], count: 0, prefix: "ambiguous" },
    ]) {
      const before = await tested.inventory();
      const count = engine.count();
      steps = 0;
      expect(
        await runEffectFailure(engine.run(host.newRequestKey(), args)),
      ).toMatchObject({ reason: engine.invalid });
      expect(engine.count()).toBe(count);
      expect(steps).toBe(0);
      expect(await tested.inventory()).toEqual(before);
    }
  }
}
