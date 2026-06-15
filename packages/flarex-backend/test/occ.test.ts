import { describe, expect, it } from "vitest";
import { findReadSetConflict } from "../src/occ";
import { encodeIndexValues, indexKeyAfterPrefix } from "../src/indexKeys";
import type { CommittedWrite, IndexWrite, ReadSet } from "../src/types";

const write = (overrides: Partial<CommittedWrite> = {}): CommittedWrite => ({
  tableId: 1,
  id: "1:doc",
  prevTs: null,
  ts: 2,
  value: { status: "done" },
  ...overrides,
});

const indexWrite = (overrides: Partial<IndexWrite> = {}): IndexWrite => ({
  indexId: 10,
  key: encodeIndexValues(["m"]),
  documentId: "1:doc",
  deleted: false,
  ...overrides,
});

function conflictFor(readSet: ReadSet) {
  return findReadSetConflict(readSet, [
    {
      ts: 2,
      writes: [write()],
      indexWrites: [indexWrite()],
    },
  ]);
}

describe("findReadSetConflict", () => {
  it("conflicts when a document read was written after beginTs", () => {
    expect(conflictFor({ documents: [{ tableId: 1, id: "1:doc" }] })).toMatchObject({
      code: "OCC_CONFLICT",
      conflictingTs: 2,
      message: "Document read was changed by a later write.",
    });
  });

  it("conflicts when a table read sees any later write in that table", () => {
    expect(conflictFor({ tables: [{ tableId: 1 }] })).toMatchObject({
      code: "OCC_CONFLICT",
      conflictingTs: 2,
      message: "Table read was changed by a later write.",
    });
  });

  it("conflicts when an index range read overlaps a later index write", () => {
    expect(
      conflictFor({
        indexes: [
          {
            indexId: 10,
            lower: encodeIndexValues(["a"]),
            upper: indexKeyAfterPrefix(encodeIndexValues(["z"]))!,
          },
        ],
      }),
    ).toMatchObject({
      code: "OCC_CONFLICT",
      conflictingTs: 2,
      message: "Index range read was changed by a later write.",
    });
  });

  it("does not conflict with unrelated document, table, or index writes", () => {
    expect(
      conflictFor({
        documents: [{ tableId: 1, id: "1:other" }],
        tables: [{ tableId: 2 }],
        indexes: [
          {
            indexId: 10,
            lower: encodeIndexValues(["x"]),
            upper: indexKeyAfterPrefix(encodeIndexValues(["z"]))!,
          },
        ],
      }),
    ).toBeNull();
  });
});
