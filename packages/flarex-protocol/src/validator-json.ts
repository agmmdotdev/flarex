import { Effect, Schema, SchemaGetter, SchemaIssue, type SchemaAST } from "effect";

import {
  decodeValidatorJsonResultCoreV1,
  decodeLegacyObjectValidatorJsonResultCoreV1,
  decodeLegacyObjectValidatorJsonWireResultCoreV1,
  encodeLegacyValidatorJsonWireCoreV1,
  decodeValidatorJsonWireResultCoreV1,
  decodeValidatorJsonWireCoreV1,
  decodeValidatorLiteralWireV1,
  encodeValidatorJsonWireCoreV1,
  encodeValidatorLiteralV1,
  isValidatorLiteralV1,
  ValidatorJsonV1InputError,
  type ObjectValidatorJsonV1 as ObjectValidatorJsonV1Type,
  type ObjectValidatorJsonWireV1 as ObjectValidatorJsonWireV1Type,
  type ValidatorJsonV1 as ValidatorJsonV1Type,
  type ValidatorJsonWireV1 as ValidatorJsonWireV1Type,
  type ValidatorJsonDecodeIssueV1,
  type ValidatorJsonDecodeResultV1,
  type ValidatorLiteralV1 as ValidatorLiteralV1Type,
  type ValidatorLiteralWireV1,
  type LegacyValidatorJsonWireV1,
  type DocumentValidatorJsonV1 as DocumentValidatorJsonV1Type,
} from "./validator-json-core";
import { FlarexValueRuntimeCoreV1Error, type FlarexNumericTagPolicyV1 } from "./value-runtime-core";
import { normalizeSourceDocumentValidator } from "./validator-source";

export {
  captureValidatorLiteralV1,
  isValidatorLiteralV1,
  decodeLegacyValidatorJsonResultCoreV1,
  decodeLegacyValidatorJsonWireResultCoreV1,
  encodeLegacyValidatorJsonWireCoreV1,
  decodeValidatorJsonResultCoreV1,
  decodeValidatorJsonWireResultCoreV1,
  decodeValidatorJsonWireCoreV1,
  decodeValidatorLiteralWireV1,
  encodeValidatorJsonWireCoreV1,
  encodeValidatorLiteralV1,
  ValidatorJsonV1InputError,
  validatorJsonAdmissionIssueV1,
  validatorJsonWireAdmissionIssueV1,
  validatorJsonHasNonfiniteLiteralV1,
  validatorIsSubsetOfStringV1,
  validatorIsStringSubtypeWithStringLiteralV1,
  validatorIsValidRecordKeyV1,
  validatorSourceRecordIssueV1,
  type ValidatorSourceRecordIssueV1,
  validatorLiteralEqualV1,
  type ValidatorJsonAdmissionIssueV1,
  type ValidatorJsonDecodeIssueV1,
  type ValidatorJsonDecodeOptionsV1,
  type ValidatorJsonDecodeResultV1,
  type ValidatorLiteralWireV1,
  type LegacyValidatorJsonWireV1,
} from "./validator-json-core";

export type ValidatorLiteralV1 = ValidatorLiteralV1Type;
export type ObjectValidatorJsonV1 = ObjectValidatorJsonV1Type;
export type ValidatorJsonV1 = ValidatorJsonV1Type;
export type ObjectValidatorJsonWireV1 = ObjectValidatorJsonWireV1Type;
export type ValidatorJsonWireV1 = ValidatorJsonWireV1Type;
export type DocumentValidatorJsonV1 = DocumentValidatorJsonV1Type;

/** Schema adapters run in trusted hosts; same-realm SDK capture uses the pure owner.
 * Effect's lazy transformation parser itself consults mutable Array.prototype.map. */
function schemaDecodeIssue(issue: ValidatorJsonDecodeIssueV1, input: unknown, options: SchemaAST.ParseOptions): SchemaIssue.Issue {
  const leaf = new SchemaIssue.InvalidValue({ message: `${issue.message} (${issue.reason})` }, input, options);
  return issue.segments.length === 0 ? leaf : new SchemaIssue.Pointer(issue.segments, leaf);
}

export const ValidatorLiteralV1: Schema.Codec<ValidatorLiteralV1> = Schema.declare<ValidatorLiteralV1>(isValidatorLiteralV1, { title: "ValidatorLiteralV1" });
export const ValidatorJsonV1: Schema.Codec<ValidatorJsonV1> = Schema.declareConstructor<ValidatorJsonV1>()([], () => (input, _ast, options) => {
  const result = decodeValidatorJsonResultCoreV1(input, options);
  return result.ok ? Effect.succeed(result.value) : Effect.fail(schemaDecodeIssue(result.issue, input, options));
}, { title: "ValidatorJsonV1" });
export const ObjectValidatorJsonV1: Schema.Codec<ObjectValidatorJsonV1> = Schema.declareConstructor<ObjectValidatorJsonV1>()([], () => (input, ast, options) => {
  const result = decodeValidatorJsonResultCoreV1(input, options);
  if (!result.ok) return Effect.fail(schemaDecodeIssue(result.issue, input, options));
  return result.value.type === "object" ? Effect.succeed(result.value) : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
}, { title: "ObjectValidatorJsonV1" });

function isLiteralWire(value: unknown, policy: FlarexNumericTagPolicyV1): value is ValidatorLiteralWireV1 {
  try { decodeValidatorLiteralWireV1(value, policy); return true; }
  catch (cause) {
    if (cause instanceof ValidatorJsonV1InputError || cause instanceof FlarexValueRuntimeCoreV1Error) return false;
    throw cause;
  }
}
const LiteralWire = Schema.declare<ValidatorLiteralWireV1>((value): value is ValidatorLiteralWireV1 => isLiteralWire(value, "canonical"), { title: "ValidatorLiteralWireV1" });
const LiteralSource = Schema.declare<ValidatorLiteralWireV1>((value): value is ValidatorLiteralWireV1 => isLiteralWire(value, "convexSchema"), { title: "ValidatorLiteralSourceV1" });

/** Numeric value-JSON projection, distinct from the core's serde schema serializer. */
export const ValidatorLiteralWireCodecV1: Schema.Codec<ValidatorLiteralV1, ValidatorLiteralWireV1> = LiteralWire.pipe(Schema.decodeTo(ValidatorLiteralV1, {
  decode: SchemaGetter.transform(value => decodeValidatorLiteralWireV1(value)),
  encode: SchemaGetter.transform(encodeValidatorLiteralV1),
}));
export const ValidatorLiteralSourceCodecV1: Schema.Codec<ValidatorLiteralV1, ValidatorLiteralWireV1> = LiteralSource.pipe(Schema.decodeTo(ValidatorLiteralV1, {
  decode: SchemaGetter.transform(value => decodeValidatorLiteralWireV1(value, "convexSchema")),
  encode: SchemaGetter.transform(encodeValidatorLiteralV1),
}));
export const decodeValidatorLiteralSourceV1 = Schema.decodeUnknownResult(ValidatorLiteralSourceCodecV1);

const Wire = Schema.declareConstructor<ValidatorJsonWireV1>()([], () => (input, _ast, options) => {
  const result = decodeValidatorJsonWireResultCoreV1(input, options);
  return result.ok ? Effect.succeed(encodeValidatorJsonWireCoreV1(result.value)) : Effect.fail(schemaDecodeIssue(result.issue, input, options));
}, { title: "ValidatorJsonWireV1" });
const ObjectWire = Schema.declareConstructor<ObjectValidatorJsonWireV1>()([], () => (input, ast, options) => {
  const result = decodeValidatorJsonWireResultCoreV1(input, options);
  if (!result.ok) return Effect.fail(schemaDecodeIssue(result.issue, input, options));
  return result.value.type === "object" ? Effect.succeed(encodeValidatorJsonWireCoreV1(result.value)) : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
}, { title: "ObjectValidatorJsonWireV1" });
export const ValidatorJsonWireCodecV1: Schema.Codec<ValidatorJsonV1, ValidatorJsonWireV1> = Wire.pipe(Schema.decodeTo(ValidatorJsonV1, {
  decode: SchemaGetter.transform(decodeValidatorJsonWireCoreV1),
  encode: SchemaGetter.transform(encodeValidatorJsonWireCoreV1),
}));
export const ObjectValidatorJsonWireCodecV1: Schema.Codec<ObjectValidatorJsonV1, ObjectValidatorJsonWireV1> = ObjectWire.pipe(Schema.decodeTo(ObjectValidatorJsonV1, {
  decode: SchemaGetter.transform(value => decodeValidatorJsonWireCoreV1(value)),
  encode: SchemaGetter.transform(value => encodeValidatorJsonWireCoreV1(value)),
}));

/** Source DocumentSchema normalization precedes its owner's finite policy. */
export const DocumentValidatorJsonV1: Schema.Codec<DocumentValidatorJsonV1> = Schema.declareConstructor<DocumentValidatorJsonV1>()([], () => (input, _ast, options) => {
  const parsed = decodeValidatorJsonResultCoreV1(input, options);
  if (!parsed.ok) return Effect.fail(schemaDecodeIssue(parsed.issue, input, options));
  const normalized = normalizeSourceDocumentValidator(parsed.value);
  return normalized.ok ? Effect.succeed(normalized.value) : Effect.fail(new SchemaIssue.InvalidValue({ message: `${normalized.issue.message} (${normalized.issue.reason}) ${normalized.issue.path}` }, input, options));
}, { title: "DocumentValidatorJsonV1" });
const DocumentWire = Schema.declareConstructor<ValidatorJsonWireV1>()([], () => (input, _ast, options) => {
  const parsed = decodeValidatorJsonWireResultCoreV1(input, options);
  if (!parsed.ok) return Effect.fail(schemaDecodeIssue(parsed.issue, input, options));
  const normalized = normalizeSourceDocumentValidator(parsed.value);
  return normalized.ok ? Effect.succeed(encodeValidatorJsonWireCoreV1(normalized.value)) : Effect.fail(new SchemaIssue.InvalidValue({ message: `${normalized.issue.message} (${normalized.issue.reason}) ${normalized.issue.path}` }, input, options));
}, { title: "DocumentValidatorJsonWireV1" });
export const DocumentValidatorJsonWireCodecV1: Schema.Codec<DocumentValidatorJsonV1, ValidatorJsonWireV1> = DocumentWire.pipe(Schema.decodeTo(DocumentValidatorJsonV1, {
  decode: SchemaGetter.transform(value => {
    const parsed = decodeValidatorJsonWireCoreV1(value);
    const normalized = normalizeSourceDocumentValidator(parsed);
    if (!normalized.ok) throw new ValidatorJsonV1InputError(normalized.issue.message);
    return normalized.value;
  }),
  encode: SchemaGetter.transform(encodeValidatorJsonWireCoreV1),
}));

export type LegacyObjectValidatorJsonWireV1 = Extract<LegacyValidatorJsonWireV1, { readonly type: "object" }>;
const LegacyObjectSemantic = Schema.declareConstructor<ObjectValidatorJsonV1>()([], () => (input, ast, options) => {
  const parsed = decodeLegacyObjectValidatorJsonResultCoreV1(input, options);
  if (!parsed.ok) return Effect.fail(schemaDecodeIssue(parsed.issue, input, options));
  return parsed.value.type === "object" ? Effect.succeed(parsed.value) : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
}, { title: "LegacyObjectValidatorJsonV1" });
const LegacyObjectWire = Schema.declareConstructor<LegacyObjectValidatorJsonWireV1>()([], () => (input, ast, options) => {
  const parsed = decodeLegacyObjectValidatorJsonWireResultCoreV1(input, options);
  if (!parsed.ok) return Effect.fail(schemaDecodeIssue(parsed.issue, input, options));
  const wire = parsed.value.type === "object" ? encodeLegacyValidatorJsonWireCoreV1(parsed.value) : undefined;
  return wire?.type === "object" ? Effect.succeed(wire) : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
}, { title: "LegacyObjectValidatorJsonWireV1" });
export const LegacyObjectValidatorJsonWireCodecV1: Schema.Codec<ObjectValidatorJsonV1, LegacyObjectValidatorJsonWireV1> = LegacyObjectWire.pipe(Schema.decodeTo(LegacyObjectSemantic, {
  decode: SchemaGetter.transform(value => {
    const parsed = decodeLegacyObjectValidatorJsonWireResultCoreV1(value);
    if (!parsed.ok || parsed.value.type !== "object") throw new ValidatorJsonV1InputError("Invalid historical object validator.");
    return parsed.value;
  }),
  encode: SchemaGetter.transform(value => {
    const wire = encodeLegacyValidatorJsonWireCoreV1(value);
    if (wire.type !== "object") throw new ValidatorJsonV1InputError("Invalid historical object validator.");
    return wire;
  }),
}));

function requireDecodedValidator(result: ValidatorJsonDecodeResultV1): ValidatorJsonV1 {
  if (!result.ok) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: protocol - public synchronous metadata codec boundary throws its pure owner's typed input failure; Schema adapters retain the typed channel.
    throw new ValidatorJsonV1InputError(`${result.issue.message} ${result.issue.path}`, result.issue);
  }
  return result.value;
}
/** Bounded semantic capture; this does not decode encoded numeric tags. */
export function decodeValidatorJsonV1(value: unknown): ValidatorJsonV1 { return requireDecodedValidator(decodeValidatorJsonResultCoreV1(value)); }
export function decodeValidatorJsonWireV1(value: unknown): ValidatorJsonV1 { return requireDecodedValidator(decodeValidatorJsonWireResultCoreV1(value)); }
export function encodeValidatorJsonV1(value: ValidatorJsonV1): ValidatorJsonWireV1 { return encodeValidatorJsonWireCoreV1(requireDecodedValidator(decodeValidatorJsonResultCoreV1(value))); }

export type ValidatorJson = ValidatorJsonV1;
export const ValidatorJson = ValidatorJsonV1;
export type ObjectValidatorJson = ObjectValidatorJsonV1;
export const ObjectValidatorJson = ObjectValidatorJsonV1;
