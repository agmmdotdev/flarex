import { indexKeyInRange } from "./indexKeys";
import type { CommittedWrite, IndexWrite, OccConflict, ReadSet } from "./types";

export type WriteLogConflictRow = {
  ts: number;
  writes: CommittedWrite[];
  indexWrites: IndexWrite[];
};

export function findReadSetConflict(
  readSet: ReadSet,
  rows: WriteLogConflictRow[],
): OccConflict | null {
  for (const row of rows) {
    if (
      readSet.documents?.some(read =>
        row.writes.some(write => write.tableId === read.tableId && write.id === read.id),
      )
    ) {
      return occ(row.ts, "Document read was changed by a later write.");
    }
    if (
      readSet.tables?.some(read =>
        row.writes.some(write => write.tableId === read.tableId),
      )
    ) {
      return occ(row.ts, "Table read was changed by a later write.");
    }
    if (
      readSet.indexes?.some(read =>
        row.indexWrites.some(
          write =>
            write.indexId === read.indexId &&
            indexKeyInRange(write.key, read.lower, read.upper),
        ),
      )
    ) {
      return occ(row.ts, "Index range read was changed by a later write.");
    }
  }
  return null;
}

export function occ(conflictingTs: number, message: string): OccConflict {
  return { code: "OCC_CONFLICT", message, conflictingTs };
}

export function isOccConflict(error: unknown): error is OccConflict {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as OccConflict).code === "OCC_CONFLICT"
  );
}
