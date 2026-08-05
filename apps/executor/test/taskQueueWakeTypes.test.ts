import type {
  TaskQueueWakeHintEnvelopeV1,
  TaskQueueWakeMessageBatchV1,
  TaskQueueWakeProducerBindingV1,
} from "@flarex/executor/internal/task-queue-wake-v1";
import { describe, expectTypeOf, it } from "vitest";

describe("DTE05-D installed Cloudflare Queue type compatibility", () => {
  it("accepts current producer and consumer callback structures", () => {
    expectTypeOf<Queue<TaskQueueWakeHintEnvelopeV1>>()
      .toMatchTypeOf<TaskQueueWakeProducerBindingV1>();
    expectTypeOf<MessageBatch<unknown>>()
      .toMatchTypeOf<TaskQueueWakeMessageBatchV1>();
  });
});
