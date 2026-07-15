import { Schema } from "effect";

import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeRunIdSchema,
  ProbeScopeIdSchema,
  ProbeSessionIdSchema,
} from "./identity";
import { ProbeProtocolVersionV1Schema } from "./protocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

const DeletedFacetCountSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= 600
      ? undefined
      : "deleted facet count must be between 0 and 600"
  ),
);

const ProbeSessionPurgeRequestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  sessionId: ProbeSessionIdSchema,
  facets: Schema.Array(
    Schema.Struct({
      attemptId: ProbeAttemptIdSchema,
      codeId: ProbeCodeIdSchema,
    }).annotate(StrictStructOptions),
  ),
}).annotate(StrictStructOptions);

export const ProbeSessionPurgeRequestV1Schema =
  ProbeSessionPurgeRequestV1Shape.check(
    Schema.makeFilter(request => {
      if (request.facets.length > 600) {
        return "session purge cannot name more than 600 facet attempts";
      }
      const unique = new Set(request.facets.map(facet => facet.attemptId));
      if (unique.size !== request.facets.length) {
        return "session purge facet attempts must be unique";
      }
      for (let index = 1; index < request.facets.length; index += 1) {
        const previous = request.facets[index - 1]?.attemptId;
        const current = request.facets[index]?.attemptId;
        if (
          previous !== undefined &&
          current !== undefined &&
          previous.localeCompare(current) >= 0
        ) {
          return "session purge facet attempts must be sorted";
        }
      }
      return undefined;
    }),
  );
export type ProbeSessionPurgeRequestV1 =
  typeof ProbeSessionPurgeRequestV1Schema.Type;

export const ProbeSessionPurgeReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("in-progress"),
    sessionId: ProbeSessionIdSchema,
    pendingFacets: DeletedFacetCountSchema,
    probeDataCleared: Schema.Literal(false),
  }).annotate(StrictStructOptions),
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("probe-data-cleared"),
    sessionId: ProbeSessionIdSchema,
    deletedFacets: DeletedFacetCountSchema,
    probeDataCleared: Schema.Literal(true),
    completionTombstoneRetained: Schema.Literal(true),
  }).annotate(StrictStructOptions),
]);
export type ProbeSessionPurgeReceiptV1 =
  typeof ProbeSessionPurgeReceiptV1Schema.Type;

export const ProbeSyncPurgeRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  scopeId: ProbeScopeIdSchema,
}).annotate(StrictStructOptions);
export type ProbeSyncPurgeRequestV1 = typeof ProbeSyncPurgeRequestV1Schema.Type;

export const ProbeSyncPurgeReceiptV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  kind: Schema.Literal("probe-data-cleared"),
  scopeId: ProbeScopeIdSchema,
  probeDataCleared: Schema.Literal(true),
  completionTombstoneRetained: Schema.Literal(true),
}).annotate(StrictStructOptions);
export type ProbeSyncPurgeReceiptV1 = typeof ProbeSyncPurgeReceiptV1Schema.Type;

export const ProbeRunPurgeRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
}).annotate(StrictStructOptions);
export type ProbeRunPurgeRequestV1 = typeof ProbeRunPurgeRequestV1Schema.Type;

export const ProbeRunPurgeReceiptV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  kind: Schema.Literal("storage-cleared"),
  runId: ProbeRunIdSchema,
  storageCleared: Schema.Literal(true),
}).annotate(StrictStructOptions);
export type ProbeRunPurgeReceiptV1 = typeof ProbeRunPurgeReceiptV1Schema.Type;

export const decodeProbeSessionPurgeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSessionPurgeRequestV1Schema);
export const decodeProbeSessionPurgeReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSessionPurgeReceiptV1Schema);
export const decodeProbeSyncPurgeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncPurgeRequestV1Schema);
export const decodeProbeSyncPurgeReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncPurgeReceiptV1Schema);
export const decodeProbeRunPurgeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunPurgeRequestV1Schema);
export const decodeProbeRunPurgeReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunPurgeReceiptV1Schema);
