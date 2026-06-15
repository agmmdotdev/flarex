import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PartitionRequestError,
  SingleShardTransaction,
} from "../src/transaction";
import type { Env } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
let env: Env;

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("SingleShardTransaction", () => {
  it("generates ids, exposes read-your-writes, and coalesces document writes", async () => {
    const tx = await SingleShardTransaction.begin(env, "tx-deployment", "user:u1");

    const id = tx.insert(1, { title: "Intro", progress: 0 });
    await expect(tx.get(1, id)).resolves.toMatchObject({
      id,
      value: { title: "Intro", progress: 0 },
    });

    await tx.patch(1, id, { progress: 1 });

    expect(tx.currentReadSet()).toEqual({});
    expect(tx.pendingWrites()).toEqual([
      {
        tableId: 1,
        id,
        value: { title: "Intro", progress: 1 },
      },
    ]);

    const commit = await tx.commit({ source: "test:mutation" });
    expect(commit.writes).toHaveLength(1);
    expect(commit.writes[0]).toMatchObject({
      tableId: 1,
      id,
      value: { title: "Intro", progress: 1 },
    });

    const readBack = await SingleShardTransaction.begin(env, "tx-deployment", "user:u1");
    await expect(readBack.get(1, id)).resolves.toMatchObject({
      id,
      value: { title: "Intro", progress: 1 },
    });
  });

  it("surfaces OCC conflicts from the partition commit path", async () => {
    const seed = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    seed.insert(1, { title: "Intro", progress: 0 }, "1:lesson");
    await seed.commit({ source: "seed" });

    const stale = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    await expect(stale.get(1, "1:lesson")).resolves.toMatchObject({
      value: { title: "Intro", progress: 0 },
    });

    const concurrent = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    concurrent.replace(1, "1:lesson", { title: "Intro", progress: 1 });
    const concurrentCommit = await concurrent.commit({ source: "concurrent" });

    stale.replace(1, "1:other", { title: "Other" });
    await expect(stale.commit({ source: "stale" })).rejects.toMatchObject({
      status: 409,
      body: {
        code: "OCC_CONFLICT",
        conflictingTs: concurrentCommit.committedTs,
      },
    } satisfies Partial<PartitionRequestError>);
  });
});
