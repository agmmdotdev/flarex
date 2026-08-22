import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeTaskInputStore,
  type TaskInputStoreBucket,
} from "../src/taskInput/TaskInputStore.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("TaskInputStore with Miniflare R2", () => {
  it("uses conditional no-replace writes and exact cold and repeat reads", async () => {
    const runtime = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      r2Buckets: ["TASK_INPUTS"],
    });
    instances.push(runtime);
    const bucket = await runtime.getR2Bucket("TASK_INPUTS");
    const store = makeTaskInputStore(
      bucket as unknown as TaskInputStoreBucket,
    );
    const value = Object.freeze({ command: "deliver", count: 2 });

    const reference = await Effect.runPromise(store.publish(value));
    await expect(Effect.runPromise(store.publish(value))).resolves.toEqual(
      reference,
    );
    const cold = await Effect.runPromise(store.read(reference));
    const repeat = await Effect.runPromise(store.read(reference));
    const raw = await bucket.get(reference.objectKey);

    expect(cold.value).toEqual(value);
    expect(repeat).toEqual(cold);
    expect(repeat.canonicalBytes).not.toBe(cold.canonicalBytes);
    expect(new Uint8Array(await raw!.arrayBuffer())).toEqual(
      cold.canonicalBytes,
    );
  });
});
