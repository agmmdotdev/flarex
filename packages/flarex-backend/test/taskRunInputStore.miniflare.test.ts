import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeTaskRunInputStore,
  type TaskRunInputStoreBucket,
} from "../src/taskRunInput/TaskRunInputStore.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("TaskRunInputStore with Miniflare R2", () => {
  it("uses conditional immutable writes and exact cold reads", async () => {
    const runtime = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      r2Buckets: ["TASK_RUN_INPUTS"],
    });
    instances.push(runtime);
    const bucket = await runtime.getR2Bucket("TASK_RUN_INPUTS");
    const store = makeTaskRunInputStore(
      bucket as unknown as TaskRunInputStoreBucket,
    );
    const value = { orderId: "order-42", quantity: 2n };

    const reference = await Effect.runPromise(store.publish(value));
    await Effect.runPromise(store.publish(value));
    const stored = await Effect.runPromise(store.read(reference));

    expect(stored.reference).toEqual(reference);
    expect(stored.value).toEqual(value);
    const raw = await bucket.get(reference.objectKey);
    expect(new Uint8Array(await raw!.arrayBuffer()))
      .toEqual(stored.canonicalBytes);
  });
});
