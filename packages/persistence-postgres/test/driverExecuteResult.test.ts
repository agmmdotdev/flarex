import { describe, expect, it } from "vitest";

import { rowsFromDriverExecuteResult } from "../src/driverExecuteResult";

describe("rowsFromDriverExecuteResult", () => {
  it("preserves the wrapped driver row array by identity", () => {
    const wrappedRows: ReadonlyArray<unknown> = [{ value: 1 }];

    expect(rowsFromDriverExecuteResult(
      { rows: wrappedRows },
      invalidResult,
    )).toBe(wrappedRows);
  });

  it("delegates unsupported driver shapes to the caller-owned failure", () => {
    const failure = new Error("invalid driver result");
    let calls = 0;

    for (const result of [
      undefined,
      null,
      [],
      {},
      { rows: null },
      { rows: {} },
    ]) {
      const thrown = captureThrow(() => rowsFromDriverExecuteResult(
        result,
        () => {
          calls += 1;
          throw failure;
        },
      ));
      expect(thrown).toBe(failure);
    }
    expect(calls).toBe(6);
  });

  it("reads a valid wrapper rows property once", () => {
    const rows: ReadonlyArray<unknown> = [{ value: 1 }];
    let reads = 0;
    const result = Object.defineProperty({}, "rows", {
      get() {
        reads += 1;
        return rows;
      },
    });

    expect(rowsFromDriverExecuteResult(result, invalidResult)).toBe(rows);
    expect(reads).toBe(1);
  });

  it("preserves exceptions raised while reading wrapper rows", () => {
    const failure = new Error("driver rows getter failed");
    let invalidCalls = 0;
    const result = Object.defineProperty({}, "rows", {
      get() {
        throw failure;
      },
    });

    const thrown = captureThrow(() => rowsFromDriverExecuteResult(
      result,
      () => {
        invalidCalls += 1;
        throw new Error("unexpected invalid-result callback");
      },
    ));
    expect(thrown).toBe(failure);
    expect(invalidCalls).toBe(0);
  });
});

function invalidResult(): never {
  throw new Error("unexpected invalid driver result");
}

function captureThrow(run: () => unknown): unknown {
  try {
    run();
  } catch (cause) {
    return cause;
  }
  return undefined;
}
