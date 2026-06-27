import { HttpError } from "../http";
import type { PushDiagnostic, PushSourcePackage } from "../types";

export function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  if (!Array.isArray(sourcePackage.modules)) {
    throw new HttpError(400, "Source package modules must be an array.");
  }
  if (!Array.isArray(sourcePackage.functions)) {
    throw new HttpError(400, "Source package functions must be an array.");
  }
  if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
    throw new HttpError(400, "Source package execution module is required.");
  }
  const seen = new Set<string>();
  const modules = sourcePackage.modules.map(module => {
    if (typeof module.path !== "string" || module.path.length === 0) {
      throw new HttpError(400, "Source package module has an invalid path.");
    }
    if (seen.has(module.path)) throw new HttpError(400, `Duplicate source module path: ${module.path}.`);
    seen.add(module.path);
    if (module.environment !== "isolate") {
      throw new HttpError(400, `Source module ${module.path} has unsupported environment ${module.environment}.`);
    }
    if (typeof module.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(module.sha256)) {
      throw new HttpError(400, `Source module ${module.path} has an invalid sha256.`);
    }
    if (module.source !== undefined && typeof module.source !== "string") {
      throw new HttpError(400, `Source module ${module.path} source must be a string.`);
    }
    if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
      throw new HttpError(400, `Source module ${module.path} sourceMap must be a string.`);
    }
    return { ...module };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has(sourcePackage.execution)) {
    throw new HttpError(400, `Source package execution module ${sourcePackage.execution} is missing.`);
  }
  if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
    throw new HttpError(400, `Source package schema module ${sourcePackage.schema} is missing.`);
  }
  const functions = [...sourcePackage.functions].sort();
  for (const fn of functions) {
    if (typeof fn !== "string" || !seen.has(fn)) {
      throw new HttpError(400, `Source package function module ${String(fn)} is missing.`);
    }
  }
  return {
    modules,
    functions,
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  };
}

export function validateDiagnostics(value: unknown): PushDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Push diagnostics must be an array.");
  }
  return value.slice(-100).map((diagnostic, index) => {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      throw new HttpError(400, `Push diagnostic at index ${index} must be an object.`);
    }
    const record = diagnostic as Partial<PushDiagnostic>;
    if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid level.`);
    }
    if (typeof record.message !== "string") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid message.`);
    }
    return {
      level: record.level,
      message: record.message,
    };
  });
}
