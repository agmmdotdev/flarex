import {
  applyApplicationManagedSchemaPlan,
  prepareApplicationManagedSchemaPlan,
  ApplicationManagedSchemaApplication,
  ApplicationManagedSchemaPlanning,
  type ApplyApplicationManagedSchemaPlanError,
  type ApplyApplicationManagedSchemaPlanInput,
  type ApplyApplicationManagedSchemaPlanResult,
  type PreparedApplicationManagedSchemaPlan,
  type PrepareApplicationManagedSchemaPlanError,
  type PrepareApplicationManagedSchemaPlanInput,
  type PreparedApplicationManagedSchemaPlanResult,
} from "@flarex/standard-application-registration/application";
import { Effect } from "effect";
import { isJson, type Json } from "flarex-protocol/json";

type JsonCompatible<Value> = Value extends null | boolean | number | string
  ? Value
  : Value extends ReadonlyArray<infer Item>
  ? ReadonlyArray<JsonCompatible<Item>>
  : Value extends object
  ? { readonly [Key in keyof Value]: JsonCompatible<Value[Key]> }
  : never;

type JsonProjection<Shape> = Readonly<Shape> & Json;

export type FlarexManagedSchemaPlanJson = JsonProjection<{
  readonly operation: "plan";
  readonly status: "planned";
  readonly plan: JsonCompatible<
    PreparedApplicationManagedSchemaPlanResult["plan"]
  >;
}>;

export type FlarexManagedSchemaApplyJson =
  | JsonProjection<{
      readonly operation: "apply";
      readonly status: "blocked";
      readonly reason: "planBlocked";
      readonly planSha256Hex: string;
    }>
  | JsonProjection<{
      readonly operation: "apply";
      readonly status: "in_progress";
      readonly phase: Extract<
        ApplyApplicationManagedSchemaPlanResult,
        { readonly status: "in_progress" }
      >["phase"];
      readonly revisionId: string;
      readonly schemaVersionId: string;
      readonly planSha256Hex: string;
      readonly detail: string;
    }>
  | JsonProjection<{
      readonly operation: "apply";
      readonly status: "requires_remediation";
      readonly reason: "candidateValidationFailed";
      readonly revisionId: string;
      readonly schemaVersionId: string;
      readonly planSha256Hex: string;
      readonly evidenceSha256Hex: string;
    }>
  | JsonProjection<{
      readonly operation: "apply";
      readonly status: "activated";
      readonly disposition: "inserted" | "replayed";
      readonly revisionId: string;
      readonly schemaVersionId: string;
      readonly planSha256Hex: string;
      readonly activationSequence: string;
    }>
  | JsonProjection<{
      readonly operation: "apply";
      readonly status: "already_active";
      readonly revisionId: string;
      readonly schemaVersionId: string;
      readonly activationSequence: string;
    }>;

export type FlarexManagedSchemaJson =
  | FlarexManagedSchemaPlanJson
  | FlarexManagedSchemaApplyJson;

export interface PreparedFlarexManagedSchemaDeployment {
  readonly prepared: PreparedApplicationManagedSchemaPlan;
  readonly projection: FlarexManagedSchemaPlanJson;
}

export const prepareFlarexManagedSchemaDeployment = Effect.fn(
  "FlarexDev.ManagedSchema.prepare",
)(function* (
  input: PrepareApplicationManagedSchemaPlanInput,
): Effect.fn.Return<
  PreparedFlarexManagedSchemaDeployment,
  PrepareApplicationManagedSchemaPlanError,
  ApplicationManagedSchemaPlanning
> {
  const result = yield* prepareApplicationManagedSchemaPlan(input);
  return Object.freeze({
    prepared: result.prepared,
    projection: projectPlan(result.plan),
  });
});

export const applyFlarexManagedSchemaDeployment = Effect.fn(
  "FlarexDev.ManagedSchema.apply",
)(function* (
  input: ApplyApplicationManagedSchemaPlanInput,
): Effect.fn.Return<
  FlarexManagedSchemaApplyJson,
  ApplyApplicationManagedSchemaPlanError,
  ApplicationManagedSchemaApplication
> {
  return projectApply(yield* applyApplicationManagedSchemaPlan(input));
});

function projectPlan(
  plan: PreparedApplicationManagedSchemaPlanResult["plan"],
): FlarexManagedSchemaPlanJson {
  const detachedPlan: JsonCompatible<
    PreparedApplicationManagedSchemaPlanResult["plan"]
  > = Object.freeze(structuredClone(plan));
  return assertJsonProjection(Object.freeze({
    operation: "plan" as const,
    status: "planned" as const,
    plan: detachedPlan,
  }));
}

function projectApply(
  result: ApplyApplicationManagedSchemaPlanResult,
): FlarexManagedSchemaApplyJson {
  switch (result.status) {
    case "blocked":
      return assertJsonProjection(Object.freeze({
        operation: "apply" as const,
        status: result.status,
        reason: result.reason,
        planSha256Hex: result.planSha256Hex,
      }));
    case "in_progress":
      return assertJsonProjection(Object.freeze({
        operation: "apply" as const,
        status: result.status,
        phase: result.phase,
        revisionId: result.revisionId,
        schemaVersionId: result.schemaVersionId,
        planSha256Hex: result.planSha256Hex,
        detail: result.detail,
      }));
    case "requires_remediation":
      return assertJsonProjection(Object.freeze({
        operation: "apply" as const,
        status: result.status,
        reason: result.reason,
        revisionId: result.revisionId,
        schemaVersionId: result.schemaVersionId,
        planSha256Hex: result.planSha256Hex,
        evidenceSha256Hex: result.evidenceSha256Hex,
      }));
    case "activated":
      return assertJsonProjection(Object.freeze({
        operation: "apply" as const,
        status: result.status,
        disposition: result.disposition,
        revisionId: result.revisionId,
        schemaVersionId: result.schemaVersionId,
        planSha256Hex: result.planSha256Hex,
        activationSequence: result.activationSequence.toString(10),
      }));
    case "already_active":
      return assertJsonProjection(Object.freeze({
        operation: "apply" as const,
        status: result.status,
        revisionId: result.revisionId,
        schemaVersionId: result.schemaVersionId,
        activationSequence: result.activationSequence.toString(10),
      }));
    default:
      return assertNever(result);
  }
}

function assertJsonProjection<Projection>(
  projection: Projection,
): Projection & Json {
  if (!isJson(projection)) {
    throw new TypeError("Managed-schema projection violated the JSON contract.");
  }
  return projection;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected managed-schema result: ${String(value)}`);
}
