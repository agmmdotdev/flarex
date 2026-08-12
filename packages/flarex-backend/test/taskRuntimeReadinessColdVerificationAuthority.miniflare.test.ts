import { Effect, Result } from "effect";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import { makeTaskRuntimeReadinessColdVerificationAuthority } from
  "../src/taskRuntimeReadiness/Authority.js";
import {
  makeTaskRuntimeObjectStore,
  type TaskRuntimeObjectStoreBucket,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";
import { makeTaskRuntimeReadinessFixture } from
  "./taskRuntimeReadinessFixture.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Task runtime readiness cold verification with Miniflare R2", () => {
  it("publishes, cold-reads, and verifies the complete canonical membership", async () => {
    const runtime = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      r2Buckets: ["TASK_RUNTIME_OBJECTS"],
    });
    instances.push(runtime);
    const bucket = await runtime.getR2Bucket("TASK_RUNTIME_OBJECTS");
    const fixture = await makeTaskRuntimeReadinessFixture();
    const store = makeTaskRuntimeObjectStore(
      bucket as unknown as TaskRuntimeObjectStoreBucket,
      fixture.sha256,
    );
    for (const object of fixture.objects) {
      await Effect.runPromise(store.publish(object));
    }
    const lengths = fixture.objects.map(object =>
      Number(object.readReference().byteLength)
    );
    const authority = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority(
        store,
        fixture.sha256,
        {
          maximumObjectCount: fixture.objects.length,
          maximumObjectBytes: Math.max(...lengths),
          maximumRetainedObjectBytes: lengths.reduce(
            (total, length) => total + length,
            0,
          ),
        },
      ),
    );

    const proof = await Effect.runPromise(authority.verify(
      fixture.preparationInput,
    ));
    const captured = Result.getOrThrow(authority.capture(proof));
    expect(captured.readBasis()).toMatchObject({
      kind: "populated",
      objectCount: BigInt(fixture.objects.length),
    });
    for (const object of fixture.objects) {
      const reference = object.readReference();
      const stored = await bucket.get(reference.objectKey);
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(
        object.readCanonicalBytes(),
      );
    }
  });
});
