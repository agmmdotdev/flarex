import {
  decodeInvokeSessionDocumentWriteRecord,
  InvokeSessionDocumentWriteCorruptionError,
  type InvokeSessionDocumentWriteCorruptionReason,
  type InvokeSessionDocumentWriteStorageRow,
} from "@flarex/persistence-postgres";
import { describe, expect, it } from "vitest";

function storageRow(
  overrides: Partial<InvokeSessionDocumentWriteStorageRow> = {},
): InvokeSessionDocumentWriteStorageRow {
  return {
    deploymentId: "deployment_test",
    sessionId: "session_test",
    tableId: 1,
    documentId: "1:document",
    op: "patch",
    valueJson: { count: 2 },
    stagedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides,
  };
}

function expectCorruption(
  row: InvokeSessionDocumentWriteStorageRow,
  reason: InvokeSessionDocumentWriteCorruptionReason,
): void {
  let captured: unknown;
  try {
    decodeInvokeSessionDocumentWriteRecord(row);
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(InvokeSessionDocumentWriteCorruptionError);
  expect(captured).toMatchObject({ reason });
}

describe("invoke-session document-write decoding", () => {
  it("decodes valid operation-specific JSON values", () => {
    expect(decodeInvokeSessionDocumentWriteRecord(storageRow())).toMatchObject({
      op: "patch",
      valueJson: { count: 2 },
    });
    expect(
      decodeInvokeSessionDocumentWriteRecord(
        storageRow({ op: "replace", valueJson: [1, true, null] }),
      ),
    ).toMatchObject({ op: "replace", valueJson: [1, true, null] });
    expect(
      decodeInvokeSessionDocumentWriteRecord(
        storageRow({ op: "delete", valueJson: null }),
      ),
    ).toMatchObject({ op: "delete", valueJson: null });
  });

  it("rejects corrupt operation and JSON combinations", () => {
    expectCorruption(
      storageRow({ valueJson: { nested: Number.POSITIVE_INFINITY } }),
      "valueNotJson",
    );
    expectCorruption(
      storageRow({ valueJson: [1, 2] }),
      "patchValueNotObject",
    );
    expectCorruption(
      storageRow({ op: "delete", valueJson: { unexpected: true } }),
      "deleteValuePresent",
    );
    expectCorruption(storageRow({ op: "unsupported" }), "opUnsupported");
  });
});
