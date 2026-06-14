export type ParsedFlarexId = {
  tableId: number;
  documentId: string;
};

export function encodeFlarexId(tableId: number, documentId: string = crypto.randomUUID()): string {
  if (!Number.isInteger(tableId) || tableId < 0) {
    throw new Error(`Flarex table id must be a non-negative integer, got ${tableId}.`);
  }
  if (documentId.length === 0) {
    throw new Error("Flarex document id suffix must not be empty.");
  }
  return `${tableId}:${documentId}`;
}

export function parseFlarexId(id: string): ParsedFlarexId | null {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;
  const tableId = Number(id.slice(0, separator));
  if (!Number.isInteger(tableId) || tableId < 0) return null;
  return { tableId, documentId: id.slice(separator + 1) };
}

export function isFlarexIdForTable(id: string, tableId: number): boolean {
  return parseFlarexId(id)?.tableId === tableId;
}
