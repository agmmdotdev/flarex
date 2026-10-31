import { isLowercaseUuidText } from "@flarex/utils/strings";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexRuntimeValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/internal/value-runtime-core";
import {
  validatorJsonAdmissionIssueV1,
  type ValidatorJsonV1,
} from "flarex-protocol/internal/validator-json-core";
import {
  validateValidatorValueIssueV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/internal/validator-engine-core";

export {
  isCanonicalFlarexRuntimeObjectV1 as isPointRuntimeObjectV1,
  validatorJsonAdmissionIssueV1 as pointRuntimeValidatorAdmissionIssueV1,
};

export function normalizePointRuntimeValueV1(
  value: unknown,
  rootPath = "$",
) {
  return normalizeFlarexRuntimeValueV1(value, "generalValue", rootPath);
}

export function requirePointRuntimeValidatorAdmissionV1(root: unknown): void {
  const issue = validatorJsonAdmissionIssueV1(root);
  if (issue === undefined) return;
  throw new Error("Exact-runtime validator contains a malformed container.");
}

export function validatePointRuntimeValueIssueV1(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  tableIdsByName: ReadonlyMap<string, number>,
): ValidatorValueIssueV1 | undefined {
  return validateValidatorValueIssueV1(validator, value, {
    path,
    idPolicy: {
      mode: "tableAware",
      check: (tableName, documentId) => {
        const tableId = tableIdsByName.get(tableName);
        if (tableId === undefined) return "unavailable";
        return isAppDocumentIdForTable(documentId, tableId)
          ? "valid"
          : "invalid";
      },
    },
  });
}

function isAppDocumentIdForTable(value: string, tableId: number): boolean {
  const separator = value.indexOf(":");
  return separator > 0 &&
    separator === value.lastIndexOf(":") &&
    value.slice(0, separator) === String(tableId) &&
    isLowercaseUuidText(value.slice(separator + 1));
}
