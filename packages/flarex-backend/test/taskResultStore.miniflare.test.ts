import { taskResultObjectKeyV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeTaskResultStore,
  type TaskResultStoreBucket,
} from "../src/taskResult/TaskResultStore.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("TaskResultStore with Miniflare R2", () => {
  it("publishes, replays, and cold-reads the exact canonical object", async () => {
    const runtime = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      r2Buckets: ["TASK_RESULTS"],
    });
    instances.push(runtime);
    const bucket = await runtime.getR2Bucket("TASK_RESULTS");
    const store = makeTaskResultStore(
      bucket as unknown as TaskResultStoreBucket,
    );
    const value = Object.freeze({ status: "complete", value: 42 });

    const commitment = await Effect.runPromise(store.publish(value));
    await expect(Effect.runPromise(store.publish(value))).resolves.toEqual(
      commitment,
    );
    const stored = await Effect.runPromise(store.read(commitment));
    const raw = await bucket.get(taskResultObjectKeyV1(commitment.sha256));

    expect(stored.value).toEqual(value);
    expect(new Uint8Array(await raw!.arrayBuffer())).toEqual(
      stored.canonicalBytes,
    );
  });
});
