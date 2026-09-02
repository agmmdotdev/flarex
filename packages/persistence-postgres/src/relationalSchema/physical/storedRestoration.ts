import { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";

import { capturePrivateCanonicalValue } from
  "../../frameworkSchema/privateCanonicalValue";
import type { FrameworkSchemaTargetNamespace } from
  "../../migrationCoordination/targetNamespace";
import type {
  RelationalPhysicalLayoutSha256,
  RelationalPhysicalNameAssignmentSha256,
} from "../../migrationCoordination/identity";
import { registerCapturedRelationalPhysicalLayout } from "./authority";
import {
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
  MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
} from "./canonical";
import { RelationalPhysicalValueError } from "./errors";
import type {
  RelationalPhysicalLayout,
  RelationalPhysicalLayoutFrame,
  RelationalPhysicalNameAssignment,
  RelationalPhysicalNameAssignmentFrame,
} from "./model";

export interface RestoreStoredRelationalPhysicalNameAssignmentInput {
  readonly frame: RelationalPhysicalNameAssignmentFrame;
  readonly assignmentSha256: RelationalPhysicalNameAssignmentSha256;
  readonly canonicalJson: string;
}

export const restoreStoredRelationalPhysicalNameAssignment = Effect.fn(
  "RelationalPhysicalNameAssignment.restoreStored",
)(function* (
  input: RestoreStoredRelationalPhysicalNameAssignmentInput,
): Effect.fn.Return<
  RelationalPhysicalNameAssignment,
  RelationalPhysicalValueError
> {
  yield* verifyStoredCanonicalEvidence(
    input.frame,
    MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
    input.assignmentSha256,
    input.canonicalJson,
  );
  return Object.freeze({
    frame: input.frame,
    assignmentSha256: input.assignmentSha256,
    canonicalJson: input.canonicalJson,
  });
});

export interface RestoreStoredRelationalPhysicalLayoutInput {
  readonly frame: RelationalPhysicalLayoutFrame;
  readonly layoutSha256: RelationalPhysicalLayoutSha256;
  readonly canonicalJson: string;
  readonly nameAssignments: readonly RelationalPhysicalNameAssignment[];
  readonly targetNamespace: FrameworkSchemaTargetNamespace;
}

export const restoreStoredRelationalPhysicalLayout = Effect.fn(
  "RelationalPhysicalLayout.restoreStored",
)(function* (
  input: RestoreStoredRelationalPhysicalLayoutInput,
): Effect.fn.Return<RelationalPhysicalLayout, RelationalPhysicalValueError> {
  if (!targetNamespaceFramesEqual(
    input.frame.targetNamespace,
    input.targetNamespace.frame,
  ) || input.frame.nameAssignments.length !== input.nameAssignments.length) {
    return yield* Effect.fail(RelationalPhysicalValueError.storedStateCorrupt());
  }
  for (let index = 0; index < input.nameAssignments.length; index += 1) {
    const embeddedFrame = input.frame.nameAssignments[index];
    const assignment = input.nameAssignments[index];
    if (embeddedFrame === undefined || assignment === undefined) {
      return yield* Effect.fail(
        RelationalPhysicalValueError.storedStateCorrupt(),
      );
    }
    yield* verifyStoredCanonicalEvidence(
      embeddedFrame,
      MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
      assignment.assignmentSha256,
      assignment.canonicalJson,
    );
  }
  yield* verifyStoredCanonicalEvidence(
    input.frame,
    MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
    input.layoutSha256,
    input.canonicalJson,
  );
  const layout = Object.freeze({
    frame: input.frame,
    layoutSha256: input.layoutSha256,
    canonicalJson: input.canonicalJson,
    nameAssignments: Object.freeze([...input.nameAssignments]),
    targetNamespace: input.targetNamespace,
  });
  registerCapturedRelationalPhysicalLayout(layout);
  return layout;
});

const verifyStoredCanonicalEvidence = Effect.fn(
  "RelationalPhysicalValue.verifyStoredCanonicalEvidence",
)(function* (
  frame: JsonObject,
  maximumCanonicalBytes: number,
  expectedSha256: string,
  expectedCanonicalJson: string,
): Effect.fn.Return<void, RelationalPhysicalValueError> {
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    maximumCanonicalBytes,
    {
      invalidInput: RelationalPhysicalValueError.storedStateCorrupt,
      hashFailure: cause => RelationalPhysicalValueError.resourceFailure(
        "decodeStoredValue",
        cause,
      ),
    },
  );
  if (
    captured.sha256Hex !== expectedSha256 ||
    captured.canonicalJson !== expectedCanonicalJson
  ) {
    return yield* Effect.fail(RelationalPhysicalValueError.storedStateCorrupt());
  }
});

function targetNamespaceFramesEqual(
  left: RelationalPhysicalLayoutFrame["targetNamespace"],
  right: RelationalPhysicalLayoutFrame["targetNamespace"],
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}
