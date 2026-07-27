import { Brand, Data, Result } from "effect";

import { hasOnlyPairedSurrogates } from "./canonical-utf8";

export type DeclarativeV2ArtifactModulePathV1 = Brand.Branded<
  string,
  "Flarex/DeclarativeV2ArtifactModulePathV1"
>;

const brandDeclarativeV2ArtifactModulePathV1 =
  Brand.nominal<DeclarativeV2ArtifactModulePathV1>();

export type DeclarativeV2ArtifactModulePathVerdictV1ErrorReason =
  | "invalidInput"
  | "invalidPath";

export class DeclarativeV2ArtifactModulePathVerdictV1Error
  extends Data.TaggedError("DeclarativeV2ArtifactModulePathVerdictV1Error")<{
    readonly reason: DeclarativeV2ArtifactModulePathVerdictV1ErrorReason;
  }> {}

function hasCanonicalArtifactModulePathSyntaxV1(value: string): boolean {
  if (value.length === 0 || !hasOnlyPairedSurrogates(value)) return false;
  let segmentStart = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const codeUnit = index === value.length ? 0x2f : value.charCodeAt(index);
    if (codeUnit === 0x5c) return false;
    if (codeUnit !== 0x2f) continue;
    const segmentLength = index - segmentStart;
    if (
      segmentLength === 0 ||
      segmentLength === 1 && value.charCodeAt(segmentStart) === 0x2e ||
      segmentLength === 2 &&
        value.charCodeAt(segmentStart) === 0x2e &&
        value.charCodeAt(segmentStart + 1) === 0x2e
    ) {
      return false;
    }
    segmentStart = index + 1;
  }
  return true;
}

export function isDeclarativeV2ArtifactModulePathV1(
  value: unknown,
): value is DeclarativeV2ArtifactModulePathV1 {
  return typeof value === "string" &&
    hasCanonicalArtifactModulePathSyntaxV1(value);
}

export function decodeDeclarativeV2ArtifactModulePathV1(
  value: unknown,
): Result.Result<
  DeclarativeV2ArtifactModulePathV1,
  DeclarativeV2ArtifactModulePathVerdictV1Error
> {
  if (typeof value !== "string") {
    return Result.fail(new DeclarativeV2ArtifactModulePathVerdictV1Error({
      reason: "invalidInput",
    }));
  }
  return hasCanonicalArtifactModulePathSyntaxV1(value)
    ? Result.succeed(brandDeclarativeV2ArtifactModulePathV1(value))
    : Result.fail(new DeclarativeV2ArtifactModulePathVerdictV1Error({
      reason: "invalidPath",
    }));
}
