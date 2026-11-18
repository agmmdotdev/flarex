import type { ApplicationDocumentObservation } from "../../materialization/model";

/** An insertion selected by the trusted working set has no database-read
 * observation. Its first canonical insert attempt authenticates this intent. */
export type GeneratedDocumentInsertionIntent = Omit<ApplicationDocumentObservation, "dependency"> & Readonly<{
  dependency: Readonly<{
    kind: "generatedInsertion";
    documentId: ApplicationDocumentObservation["documentId"];
    effectOrdinal: number;
    /** Retained origin was authenticated from its original durable receipt. */
    origin?: Readonly<{ syscallSequence: bigint; sourceBindingSha256Hex: string }>;
  }>;
}>;
export type LogicalDocumentPointEvidence = ApplicationDocumentObservation | GeneratedDocumentInsertionIntent;

/** The SQL head selector and original-to-final planner need an expected empty
 * original for an insertion. This projection is never an observed-read verdict;
 * publication separately consumes the authenticated insertion intent. */
export function projectLogicalPointExpectation(point: LogicalDocumentPointEvidence): ApplicationDocumentObservation {
  if (point.dependency.kind === "appRowPoint") return { ...point, dependency: point.dependency };
  return {
    documentId: point.documentId, tableId: point.tableId, rowId: point.rowId, readAt: point.readAt,
    dependency: { kind: "appRowPoint", documentId: point.documentId,
      observed: { kind: "missing", basis: { kind: "noVisibleRevision" } } },
  };
}
