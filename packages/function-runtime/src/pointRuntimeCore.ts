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
  switch (issue.reason) {
    case "tooManyNodes":
      throw new Error("Exact-runtime validator has too many nodes.");
    case "tooDeep":
      throw new Error("Exact-runtime validator is too deeply nested.");
    case "tooManyObjectFields":
      throw new Error("Exact-runtime object validator has too many fields.");
    case "malformedContainer":
      throw new Error("Exact-runtime validator contains a malformed container.");
  }
  return rejectUnhandledAdmissionReason(issue.reason);
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      .test(value.slice(separator + 1));
}

function rejectUnhandledAdmissionReason(reason: never): never {
  throw new Error(
    `Exact-runtime validator has an unsupported admission issue: ${String(reason)}.`,
  );
}
