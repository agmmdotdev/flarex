import { Cause, Schema } from "effect";
import { failureTokens } from "../support/measurement";

const SafeToken = Schema.String.check(Schema.makeFilter(value => /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(value)
  ? undefined : "Expected a safe diagnostic token"));
const isSafeToken = Schema.is(SafeToken);
const PathStep = Schema.Union([Schema.Natural, Schema.Literals(["aggregate", "cause", "effect"])]);
export const FailureEvidenceSchema = Schema.Struct({
  stage: SafeToken,
  outcome: Schema.Literals(["typedFailure", "defect", "interruption", "mixed", "foreign", "unknown"]),
  reasons: Schema.Array(Schema.Struct({
    kind: Schema.Literals(["fail", "die", "interrupt", "foreign"]),
    index: Schema.Natural,
    reasonPath: Schema.Array(PathStep),
    tokens: Schema.Array(SafeToken),
  })),
  tokens: Schema.Array(SafeToken),
  truncated: Schema.Boolean,
});
export type FailureEvidence = typeof FailureEvidenceSchema.Type;
type Reason = FailureEvidence["reasons"][number];
type Path = Reason["reasonPath"];

const limits = { depth: 16, nodes: 256, reasons: 128, tokenDepth: 8, tokenNodes: 32 };
const tokenKeys = ["_tag", "code", "reason", "kind"];
const nestedTokenKeys = ["cause", "error", "failure", "failures", "defect", "errors", "reasons", "reason"];

/** Safe capture is deliberately narrower than structural decoding: it does not
 * invoke foreign accessors or enumerate arbitrary input, messages or stacks. */
function readData(value: object, key: string, inherited = false): Readonly<{ value: unknown; blocked: boolean }> {
  try {
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return "value" in descriptor
        ? { value: descriptor.value, blocked: false } : { value: undefined, blocked: true };
      if (!inherited) return { value: undefined, blocked: false };
      current = Object.getPrototypeOf(current);
    }
    return { value: undefined, blocked: current !== null };
  } catch {
    return { value: undefined, blocked: true };
  }
}

/** Translate only safe token-bearing fields before calling the existing token
 * owner. Its traversal therefore receives a bounded, accessor-free projection. */
function tokensFor(value: unknown, truncated: () => void): readonly string[] {
  const ancestors = new Set<object>();
  let nodes = 0;
  const capture = (member: unknown, depth: number): unknown => {
    if (depth > limits.tokenDepth || nodes++ >= limits.tokenNodes) {
      truncated();
      return undefined;
    }
    if (typeof member !== "object" || member === null) return undefined;
    if (ancestors.has(member)) { truncated(); return undefined; }
    ancestors.add(member);
    try {
      if (Array.isArray(member)) {
        const length = readData(member, "length");
        if (length.blocked || typeof length.value !== "number" || !Number.isSafeInteger(length.value) || length.value < 0) { truncated(); return undefined; }
        const entries: unknown[] = [];
        for (let index = 0; index < length.value; index++) {
          if (nodes >= limits.tokenNodes) { truncated(); break; }
          const entry = readData(member, String(index));
          if (entry.blocked) truncated();
          else entries.push(capture(entry.value, depth + 1));
        }
        return entries;
      }
      const projection: Record<string, unknown> = {};
      for (const key of tokenKeys) {
        const field = readData(member, key);
        if (field.blocked) truncated();
        else if (typeof field.value === "string") projection[key] = field.value;
      }
      for (const key of nestedTokenKeys) {
        const field = readData(member, key);
        if (field.blocked) truncated();
        else if (typeof field.value === "object" && field.value !== null) projection[key] = capture(field.value, depth + 1);
      }
      return projection;
    } finally {
      ancestors.delete(member);
    }
  };
  const tokens: string[] = [];
  try {
    if (value instanceof Error) {
      const name = readData(value, "name", true);
      if (name.blocked) truncated();
      else if (typeof name.value === "string") tokens.push(...failureTokens({ _tag: name.value }));
    }
  } catch { truncated(); }
  tokens.push(...failureTokens(capture(value, 0)));
  return [...new Set(tokens)];
}

/** Preserves real Effect reason order and multiplicity. A rejected foreign
 * value never becomes an Effect Fail merely because it carries a typed tag. */
export function describeFailure(stage: string, cause: unknown): FailureEvidence {
  const reasons: Reason[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  let truncated = false;
  const truncate = () => { truncated = true; };
  const append = (kind: Reason["kind"], path: Path, value: unknown, tag?: string) => {
    if (reasons.length >= limits.reasons) { truncate(); return; }
    const tokens = [...new Set([...(tag === undefined ? [] : failureTokens({ _tag: tag })), ...tokensFor(value, truncate)])];
    reasons.push({ kind, index: reasons.length, reasonPath: path, tokens });
  };
  const visit = (value: unknown, path: Path, depth: number) => {
    if (depth > limits.depth || nodes++ >= limits.nodes || reasons.length >= limits.reasons) { truncate(); return; }
    if (typeof value === "object" && value !== null) {
      if (ancestors.has(value)) { truncate(); return; }
      ancestors.add(value);
    }
    try {
      if (Cause.isCause(value)) {
        const retained = readData(value, "reasons");
        if (retained.blocked || !Array.isArray(retained.value)) { truncate(); append("foreign", path, undefined); return; }
        const sourceReasons: readonly unknown[] = retained.value;
        const capturedLength = readData(sourceReasons, "length");
        if (capturedLength.blocked || typeof capturedLength.value !== "number" || !Number.isSafeInteger(capturedLength.value) || capturedLength.value < 0) {
          truncate(); append("foreign", path, undefined); return;
        }
        const reasonCount = capturedLength.value;
        for (let index = 0; index < reasonCount; index++) {
          if (reasons.length >= limits.reasons) { truncate(); break; }
          const entry = readData(sourceReasons, String(index));
          const reason = entry.value;
          const reasonPath: Path = [...path, "effect", index];
          if (entry.blocked || typeof reason !== "object" || reason === null) { truncate(); append("foreign", reasonPath, undefined); continue; }
          const tag = readData(reason, "_tag");
          if (tag.blocked) { truncate(); append("foreign", reasonPath, undefined); continue; }
          switch (tag.value) {
            case "Fail": {
              const error = readData(reason, "error");
              if (error.blocked) truncate();
              append("fail", reasonPath, error.value, "Fail");
              break;
            }
            case "Die": {
              const defect = readData(reason, "defect");
              if (defect.blocked) truncate();
              append("die", reasonPath, defect.value, "Die");
              break;
            }
            case "Interrupt": append("interrupt", reasonPath, undefined, "Interrupt"); break;
            default: truncate(); append("foreign", reasonPath, reason);
          }
        }
        return;
      }
      if (value instanceof AggregateError) {
        const errors = readData(value, "errors");
        if (errors.blocked || !Array.isArray(errors.value)) { truncate(); append("foreign", path, value); return; }
        const members: readonly unknown[] = errors.value;
        const capturedLength = readData(members, "length");
        if (capturedLength.blocked || typeof capturedLength.value !== "number" || !Number.isSafeInteger(capturedLength.value) || capturedLength.value < 0) {
          truncate(); append("foreign", path, undefined); return;
        }
        const memberCount = capturedLength.value;
        if (memberCount === 0) append("foreign", path, value);
        for (let index = 0; index < memberCount; index++) {
          if (nodes >= limits.nodes || reasons.length >= limits.reasons) { truncate(); break; }
          const member = readData(members, String(index));
          if (member.blocked) { truncate(); append("foreign", [...path, "aggregate", index], undefined); }
          else visit(member.value, [...path, "aggregate", index], depth + 1);
        }
        return;
      }
      append("foreign", path, value);
      if (typeof value === "object" && value !== null) {
        const nested = readData(value, "cause");
        if (nested.blocked) truncate();
        else if (nested.value !== undefined) visit(nested.value, [...path, "cause", 0], depth + 1);
      }
    } catch {
      // This is only foreign inspection (including proxy traps). The original
      // failure remains with the runner; unavailable diagnostics are explicit.
      truncate();
      append("foreign", path, undefined);
    } finally {
      if (typeof value === "object" && value !== null) ancestors.delete(value);
    }
  };
  visit(cause, [], 0);
  const kinds = new Set(reasons.map(reason => reason.kind));
  const outcome: FailureEvidence["outcome"] = truncated || reasons.length === 0 || cause === undefined
    ? "unknown" : kinds.size > 1 ? "mixed" : kinds.has("fail") ? "typedFailure"
      : kinds.has("die") ? "defect" : kinds.has("interrupt") ? "interruption" : "foreign";
  return { stage: isSafeToken(stage) ? stage : "unknownStage", outcome, reasons,
    tokens: [...new Set(reasons.flatMap(reason => reason.tokens))], truncated };
}
