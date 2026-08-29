import { Result } from "effect";

import {
  QuerySyncEpochMismatchError,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
} from "./Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncAuthorityOperation,
} from "./Errors.js";
import type { NamespaceCursor } from "./Model.js";

export function namespaceMismatch<
  Operation extends QuerySyncAuthorityOperation,
>(
  operation: Operation,
  expected: NamespaceCursor,
  observedNamespaceId: string,
): QuerySyncNamespaceMismatchError<Operation> {
  return new QuerySyncNamespaceMismatchError<Operation>({
    operation,
    expectedNamespaceId: expected.namespaceId,
    observedNamespaceId,
  });
}

export function modelMismatch<Operation extends QuerySyncAuthorityOperation>(
  operation: Operation,
  expected: NamespaceCursor,
  observedSyncModelId: string,
): QuerySyncModelMismatchError<Operation> {
  return new QuerySyncModelMismatchError<Operation>({
    operation,
    expectedSyncModelId: expected.syncModelId,
    observedSyncModelId,
  });
}

export function epochMismatch<Operation extends QuerySyncAuthorityOperation>(
  operation: Operation,
  expected: NamespaceCursor,
  observedSourceEpoch: string,
): QuerySyncEpochMismatchError<Operation> {
  return new QuerySyncEpochMismatchError<Operation>({
    operation,
    expectedSourceEpoch: expected.sourceEpoch,
    observedSourceEpoch,
    resetRequired: true,
  });
}

export function validateQuerySyncAuthority<
  Operation extends QuerySyncAuthorityOperation,
>(
  operation: Operation,
  expected: NamespaceCursor,
  observed: {
    readonly namespaceId: string;
    readonly syncModelId: string;
    readonly sourceEpoch: string;
  },
): Result.Result<void, QuerySyncAuthorityError<Operation>> {
  if (observed.namespaceId !== expected.namespaceId) {
    return Result.fail(namespaceMismatch(
      operation,
      expected,
      observed.namespaceId,
    ));
  }
  if (observed.syncModelId !== expected.syncModelId) {
    return Result.fail(modelMismatch(
      operation,
      expected,
      observed.syncModelId,
    ));
  }
  if (observed.sourceEpoch !== expected.sourceEpoch) {
    return Result.fail(epochMismatch(
      operation,
      expected,
      observed.sourceEpoch,
    ));
  }
  return Result.succeed(undefined);
}
