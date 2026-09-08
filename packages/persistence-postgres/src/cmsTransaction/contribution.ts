import { Effect } from "effect";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import type { PointCommitDependencyV1 } from "../applicationDocumentMaterialization/model";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import type { CmsClosedDocuments } from "./documents";
import { cmsError } from "./model";
/** Domain validation after the live document owner consumes its closure. */
export const validateCmsDocumentContribution = Effect.fn("CmsCommit.validateContribution")(function* (admission: CmsAdmission, closed: CmsClosedDocuments) {
 const state = yield* requireCmsAdmission(admission);
      const allowed = new Set(
        state.frame.payloadContent?.tables.map((table) => table.tableId),
      );
      const noFinal = yield* Effect.forEach(closed.noFinalRows, (documentId) =>
        Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId)).pipe(
          Effect.mapError((cause) => cmsError("storedCorruption", cause)),
          Effect.map(
            (row) =>
              ({
                documentId: row.id,
                tableId: row.tableId,
                rowId: row.rowId,
                dependency: {
                  kind: "appRowPoint",
                  documentId: row.id,
                  observed: {
                    kind: "missing",
                    basis: { kind: "noVisibleRevision" },
                  },
                },
              }) satisfies PointCommitDependencyV1,
          ),
        ),
      );
      const dependencies = [...closed.changes, ...noFinal].toSorted(
        (a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId),
      );
      const dispositions = new Map(
        dependencies.map((row) => [row.documentId, row]),
      );
      if (
        dispositions.size !== dependencies.length ||
        dependencies.some((row) => !allowed.has(row.tableId.toString())) ||
        closed.attempts.some(
          (attempt, index) =>
            attempt.ordinal !== index || !dispositions.has(attempt.documentId),
        ) ||
        dependencies.some(
          (row) =>
            !closed.attempts.some(
              (attempt) => attempt.documentId === row.documentId,
            ),
        )
      ) {
        return yield* Effect.fail(cmsError("invalidAuthority"));
      }
return Object.freeze({ changes: closed.changes, dependencies });
});
