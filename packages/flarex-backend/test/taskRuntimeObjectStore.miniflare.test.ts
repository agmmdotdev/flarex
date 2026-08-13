import {
  makeLiveStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  type PreparedTaskRuntimeObject,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeTaskRuntimeObjectStore,
  type TaskRuntimeObjectStoreBucket,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("TaskRuntimeObjectStore with Miniflare R2", () => {
  it("uses conditional no-replace writes and exact cold reads", async () => {
    const runtime = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      r2Buckets: ["TASK_RUNTIME_OBJECTS"],
    });
    instances.push(runtime);
    const bucket = await runtime.getR2Bucket("TASK_RUNTIME_OBJECTS");
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const bytes = new TextEncoder().encode("miniflare-task-runtime-object");
    const digest = await Effect.runPromise(
      sha256(bytes, { maximumInputBytes: bytes.byteLength }),
    ) as TaskDefinitionSha256V1;
    const reference: TaskRuntimeObjectReferenceV1 = Object.freeze({
      storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
      role: "task_runtime_projection",
      objectKey: taskRuntimeObjectKeyV1(
        "task_runtime_projection",
        toHex(digest),
      ),
      byteLength: BigInt(bytes.byteLength),
      sha256: copyBytes(digest) as TaskDefinitionSha256V1,
    });
    const object: PreparedTaskRuntimeObject = Object.freeze({
      role: reference.role,
      codecIdentity: "flarex.standard-application/task-runtime-projection/v1",
      ordinal: 0n,
      readCanonicalBytes: () => copyBytes(bytes),
      readReference: () => copyReference(reference),
    });
    const store = makeTaskRuntimeObjectStore(
      bucket as unknown as TaskRuntimeObjectStoreBucket,
      sha256,
    );

    await Effect.runPromise(store.publish(object));
    await Effect.runPromise(store.publish(object));
    const stored = await Effect.runPromise(store.read(reference));

    expect(stored.reference).toEqual(reference);
    expect(stored.bytes).toEqual(bytes);
    const raw = await bucket.get(reference.objectKey);
    expect(new Uint8Array(await raw!.arrayBuffer())).toEqual(bytes);
  });
});

function copyReference(
  reference: TaskRuntimeObjectReferenceV1,
): TaskRuntimeObjectReferenceV1 {
  return Object.freeze({
    ...reference,
    sha256: copyBytes(reference.sha256) as TaskDefinitionSha256V1,
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
