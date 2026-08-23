import { Result } from "effect";
import {
  canonicalizeRelationDeclarationV1Result,
  compareRelationDeclarationsV1,
  decodeRelationDeclarationsV1Result,
  type CanonicalRelationDeclarationV1,
} from "flarex-protocol/internal/relation-declaration-v1";

import {
  StandardApplicationRelationDefinitionError,
  type PrepareStandardApplicationRelationsError,
} from "./Errors.js";
import type { PreparedStandardApplicationRelations } from "./Model.js";

/**
 * Decodes, owns, canonicalizes, and orders the declarations that the generated
 * schema module will expose to Application Analysis.
 */
export function prepareStandardApplicationRelations(
  input: unknown,
): Result.Result<
  PreparedStandardApplicationRelations,
  PrepareStandardApplicationRelationsError
> {
  return Result.gen(function* () {
    const decoded = yield* decodeRelationDeclarationsV1Result(input);
    const entries: Array<Readonly<{
      readonly declaration: CanonicalRelationDeclarationV1;
      readonly inputIndex: number;
    }>> = [];
    for (const [inputIndex, declaration] of decoded.entries()) {
      entries.push(Object.freeze({
        declaration: yield* canonicalizeRelationDeclarationV1Result(
          declaration,
        ),
        inputIndex,
      }));
    }
    entries.sort((left, right) =>
      compareRelationDeclarationsV1(
        left.declaration.declaration,
        right.declaration.declaration,
      )
    );
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (
        previous !== undefined && current !== undefined &&
        compareRelationDeclarationsV1(
            previous.declaration.declaration,
            current.declaration.declaration,
          ) === 0
      ) {
        return yield* Result.fail(
          new StandardApplicationRelationDefinitionError({
            operation: "prepare",
            reason: "duplicateDeclaration",
            path: `relations[${current.inputIndex}]`,
            conflictsWithPath: `relations[${previous.inputIndex}]`,
          }),
        );
      }
    }
    return Object.freeze({
      declarations: Object.freeze(entries.map(entry => entry.declaration)),
    });
  });
}
