import {
  isNonArrayRecord as isRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import type { DeploymentSchema } from "./deployment";
import { isJson } from "./json";

export type PartitionJson =
  | null
  | boolean
  | number
  | string
  | PartitionJson[]
  | { [key: string]: PartitionJson };

export type PartitionDocumentRead = {
  tableId: number;
  id: string;
};

export type PartitionTableRead = {
  tableId: number;
};

export type PartitionIndexRead = {
  indexId: number;
  lower?: string;
  upper?: string;
};

export type PartitionReadSet = {
  documents?: PartitionDocumentRead[];
  tables?: PartitionTableRead[];
  indexes?: PartitionIndexRead[];
};

export type PartitionDocumentWrite = {
  tableId: number;
  id?: string;
  value: PartitionJson | null;
};

export type PartitionSchemaCacheRequest = Partial<DeploymentSchema> & {
  partitionKey?: string;
  schema?: Partial<DeploymentSchema>;
};

export type PartitionSubscriptionRegistrationRequest = {
  connectionName: string;
  queryId: number;
  readSet: PartitionReadSet;
};

export type PartitionSubscriptionTargetRequest = {
  connectionName: string;
  queryId: number;
};

export type PartitionConnectionUnregisterRequest = {
  connectionName: string;
};

export type PartitionCommitRequest = {
  beginTs: number;
  schemaVersion?: number;
  source?: string;
  idempotencyKey?: string;
  readSet?: PartitionReadSet;
  writes: PartitionDocumentWrite[];
};

export class PartitionRoutePayloadError extends Data.TaggedError("PartitionRoutePayloadError")<{
  readonly message: string;
}> {}

export const decodePartitionSchemaCachePayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSchemaCachePayload",
)(
  (value: unknown): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    Effect.fromResult(normalizePartitionSchemaCachePayload(value)),
);

export const decodePublicPartitionSchemaCachePayloadEffect = Effect.fn(
  "PartitionProtocol.decodePublicSchemaCachePayload",
)(
  (
    value: unknown,
    partitionKey: string,
  ): Effect.Effect<PartitionSchemaCacheRequest, PartitionRoutePayloadError> =>
    decodePartitionSchemaCachePayloadEffect(value).pipe(
      Effect.map(schema => ({ partitionKey, schema })),
    ),
);

export const decodePartitionCommitPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeCommitPayload",
)(
  (value: unknown): Effect.Effect<PartitionCommitRequest, PartitionRoutePayloadError> =>
    Effect.fromResult(normalizePartitionCommitPayload(value)),
);

export const decodePartitionSubscriptionRegistrationPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSubscriptionRegistrationPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> =>
    Effect.fromResult(normalizePartitionSubscriptionRegistrationPayload(value)),
);

export const decodePartitionSubscriptionTargetPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSubscriptionTargetPayload",
)(
  (value: unknown): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> =>
    Effect.fromResult(normalizePartitionSubscriptionTargetPayload(value)),
);

export const decodePartitionConnectionUnregisterPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeConnectionUnregisterPayload",
)(
  (
    value: unknown,
  ): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> =>
    Effect.fromResult(normalizePartitionConnectionUnregisterPayload(value)),
);

function normalizePartitionSchemaCachePayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSchemaCacheRequest> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure("schema-cache request body must be an object.");
  }
  return Result.succeed(value as PartitionSchemaCacheRequest);
}

function normalizePartitionCommitPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionCommitRequest> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure("commit request body must be an object.");
  }
  return Result.gen(function* () {
    const beginTs = yield* requiredIntegerField(value, "beginTs");
    const schemaVersion = yield* (value.schemaVersion === undefined
      ? Result.succeed(undefined)
      : integerField(value, "schemaVersion"));
    const source = yield* (value.source === undefined
      ? Result.succeed(undefined)
      : stringField(value, "source"));
    const idempotencyKey = yield* (value.idempotencyKey === undefined
      ? Result.succeed(undefined)
      : stringField(value, "idempotencyKey"));
    const readSet = yield* (value.readSet === undefined
      ? Result.succeed(undefined)
      : readSetField(value, "readSet"));
    const writes = yield* writesField(value, "writes");

    return {
      beginTs,
      ...(schemaVersion === undefined ? {} : { schemaVersion }),
      ...(source === undefined ? {} : { source }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(readSet === undefined ? {} : { readSet }),
      writes,
    };
  });
}

function normalizePartitionSubscriptionRegistrationPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSubscriptionRegistrationRequest> {
  return Result.gen(function* () {
    const target = yield* normalizePartitionSubscriptionTargetPayload(value);
    const readSet = yield* requiredReadSet(value, "readSet");
    return { ...target, readSet };
  });
}

function normalizePartitionSubscriptionTargetPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSubscriptionTargetRequest> {
  return Result.gen(function* () {
    const connectionName = yield* requiredStringField(value, "connectionName");
    const queryId = yield* requiredIntegerField(value, "queryId");
    return { connectionName, queryId };
  });
}

function normalizePartitionConnectionUnregisterPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionConnectionUnregisterRequest> {
  return requiredStringField(value, "connectionName").pipe(
    Result.map(connectionName => ({ connectionName })),
  );
}

function requiredStringField(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  if (isRecord(value)) {
    const property = value[field];
    if (isNonEmptyString(property)) {
      return Result.succeed(property);
    }
  }
  return partitionRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
}

function requiredIntegerField(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<number> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an integer.`);
  }
  return integerField(value, field);
}

function integerField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<number> {
  const property = propertyForPath(value, field);
  if (typeof property !== "number" || !Number.isInteger(property)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an integer.`);
  }
  return Result.succeed(property);
}

function requiredReadSet(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionReadSet> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an object.`);
  }
  return readSetField(value, field);
}

function stringField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRoutePayloadValidationFailure(`${field} must be a string.`);
  }
  return Result.succeed(property);
}

function readSetField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionReadSet> {
  const candidate = value[field];
  if (!isRecord(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an object.`);
  }
  return Result.gen(function* () {
    const documents = yield* (candidate.documents === undefined
      ? Result.succeed(undefined)
      : documentReadsField(candidate, `${field}.documents`));
    const tables = yield* (candidate.tables === undefined
      ? Result.succeed(undefined)
      : tableReadsField(candidate, `${field}.tables`));
    const indexes = yield* (candidate.indexes === undefined
      ? Result.succeed(undefined)
      : indexReadsField(candidate, `${field}.indexes`));

    return {
      ...(documents === undefined ? {} : { documents }),
      ...(tables === undefined ? {} : { tables }),
      ...(indexes === undefined ? {} : { indexes }),
    };
  });
}

function documentReadsField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionDocumentRead[]> {
  const candidate = value.documents;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  return Result.gen(function* () {
    const entries: PartitionDocumentRead[] = [];
    for (const [index, entry] of candidate.entries()) {
      const path = `${field}[${index}]`;
      if (!isRecord(entry)) {
        return yield* partitionRoutePayloadValidationFailure(`${path} must be an object.`);
      }
      const tableId = yield* integerField(entry, `${path}.tableId`);
      const id = yield* nonEmptyStringProperty(entry, `${path}.id`);
      entries.push({ tableId, id });
    }
    return entries;
  });
}

function tableReadsField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionTableRead[]> {
  const candidate = value.tables;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  return Result.gen(function* () {
    const entries: PartitionTableRead[] = [];
    for (const [index, entry] of candidate.entries()) {
      const path = `${field}[${index}]`;
      if (!isRecord(entry)) {
        return yield* partitionRoutePayloadValidationFailure(`${path} must be an object.`);
      }
      const tableId = yield* integerField(entry, `${path}.tableId`);
      entries.push({ tableId });
    }
    return entries;
  });
}

function indexReadsField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionIndexRead[]> {
  const candidate = value.indexes;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  return Result.gen(function* () {
    const entries: PartitionIndexRead[] = [];
    for (const [index, entry] of candidate.entries()) {
      const path = `${field}[${index}]`;
      if (!isRecord(entry)) {
        return yield* partitionRoutePayloadValidationFailure(`${path} must be an object.`);
      }
      const indexId = yield* integerField(entry, `${path}.indexId`);
      const lower = yield* (entry.lower === undefined
        ? Result.succeed(undefined)
        : stringProperty(entry, `${path}.lower`));
      const upper = yield* (entry.upper === undefined
        ? Result.succeed(undefined)
        : stringProperty(entry, `${path}.upper`));
      entries.push({
        indexId,
        ...(lower === undefined ? {} : { lower }),
        ...(upper === undefined ? {} : { upper }),
      });
    }
    return entries;
  });
}

function writesField(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionDocumentWrite[]> {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  return Result.gen(function* () {
    const writes: PartitionDocumentWrite[] = [];
    for (const [index, entry] of candidate.entries()) {
      const path = `${field}[${index}]`;
      if (!isRecord(entry)) {
        return yield* partitionRoutePayloadValidationFailure(`${path} must be an object.`);
      }
      const tableId = yield* integerField(entry, `${path}.tableId`);
      const id = yield* (entry.id === undefined
        ? Result.succeed(undefined)
        : nonEmptyStringProperty(entry, `${path}.id`));
      const value = yield* jsonProperty(entry, `${path}.value`);
      writes.push({
        tableId,
        ...(id === undefined ? {} : { id }),
        value,
      });
    }
    return writes;
  });
}

function jsonProperty(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionJson | null> {
  const property = propertyForPath(value, field);
  if (!isJson(property)) {
    return partitionRoutePayloadValidationFailure(`${field} must be a JSON value.`);
  }
  return Result.succeed(property as PartitionJson);
}

function nonEmptyStringProperty(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (!isNonEmptyString(property)) {
    return partitionRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
  }
  return Result.succeed(property);
}

function stringProperty(
  value: UnknownRecord,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRoutePayloadValidationFailure(`${field} must be a string.`);
  }
  return Result.succeed(property);
}

function propertyForPath(value: UnknownRecord, field: string): unknown {
  const propertyName = field.slice(field.lastIndexOf(".") + 1);
  return value[propertyName];
}

type PartitionRoutePayloadValidationResult<A> = Result.Result<A, PartitionRoutePayloadError>;

function partitionRoutePayloadValidationFailure<A = never>(
  message: string,
): PartitionRoutePayloadValidationResult<A> {
  return Result.fail(new PartitionRoutePayloadError({ message }));
}
