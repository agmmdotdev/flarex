import { copyBytes } from "@flarex/utils/bytes";
import type {
  TaskRunInputStoreBucket,
} from "flarex-backend/internal/task-run-input-store";

export class MemoryTaskRunInputBucket implements TaskRunInputStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;
  getCalls = 0;
  deleteCalls = 0;
  rejectPuts = false;
  rejectGets = false;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: "*" } },
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.rejectPuts) throw new Error("Task input put unavailable.");
    if (this.values.has(key)) throw new Error("Task input already exists.");
    this.values.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.rejectGets) throw new Error("Task input get unavailable.");
    const stored = this.values.get(key);
    if (stored === undefined) return null;
    const bytes = copyBytes(stored);
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
}

export function runInputCreationCommand(
  requestKey: string,
  taskDefinitionRevisionId: string,
  input: unknown,
) {
  return Object.freeze({ requestKey, taskDefinitionRevisionId, input });
}
