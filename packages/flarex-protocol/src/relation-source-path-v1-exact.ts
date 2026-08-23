import { Result } from "effect";

import {
  exactOwnDataIssue,
  hasExactOwnDataKeys,
  inspectOwnDataArray,
  inspectOwnDataRecord,
  type ExactOwnDataIssue,
} from "./exact-own-data";

export function snapshotExactRelationSourcePathV1(
  input: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): Result.Result<unknown, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const sourcePath = yield* inspectOwnDataArray(
      input,
      path,
      { exactLength: 1 },
      ancestors,
    );
    const segment = yield* inspectOwnDataRecord(
      sourcePath.values[0],
      `${path}[0]`,
      sourcePath.ancestors,
    );
    if (!hasExactOwnDataKeys(segment.properties, ["kind", "name"])) {
      return yield* Result.fail(exactOwnDataIssue(`${path}[0]`));
    }
    return [{
      kind: segment.properties.get("kind"),
      name: segment.properties.get("name"),
    }];
  });
}
