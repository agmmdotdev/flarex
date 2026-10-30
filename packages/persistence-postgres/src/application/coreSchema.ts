import { Effect, Result, Schema } from "effect";
import { SchemaManifestAppDeveloperOrderedIndexSpecV1Schema } from "flarex-protocol/schema-manifest";

import type { CoreDatabase, CoreError, CoreIndexDefinition, CoreInstallation, CoreTableDefinition } from "../core/api";
import type { CoreIndexRef } from "../core/contracts";

const decodeDeclaredIndex = Schema.decodeUnknownResult(SchemaManifestAppDeveloperOrderedIndexSpecV1Schema);

/** User-declared fields, before Application appends its default sort field. */
export type CoreApplicationIndexDeclaration = Omit<CoreIndexDefinition, "fields"> & {
  readonly fields: readonly string[];
};

export type CoreApplicationTableDeclaration = Omit<CoreTableDefinition, "indexes"> & {
  readonly intrinsicIndexes: Readonly<{ byId: CoreIndexRef; byCreationTime: CoreIndexRef }>;
  readonly indexes: readonly CoreApplicationIndexDeclaration[];
};

export type CoreApplicationSchemaInstallation = Omit<CoreInstallation, "tables"> & {
  readonly tables: readonly CoreApplicationTableDeclaration[];
};

/**
 * Compile declared Application indexes to the full installed field sequence.
 * Convex Application::_validate_user_defined_index_fields adds creation time
 * before IndexedFields' implicit developer-ID tie breaker (db914cf06).
 * The canonical Application declaration decoder owns path, system-field,
 * uniqueness and declared-field-count validation (15 + creation time = 16).
 * Intrinsic by_id / by_creation_time definitions do not pass through here.
 */
export function compileCoreApplicationIndexes(
  declarations: readonly CoreApplicationIndexDeclaration[],
): Result.Result<readonly CoreIndexDefinition[], Schema.SchemaError> {
  return Result.gen(function* () {
    const indexes: CoreIndexDefinition[] = [];
    for (const declaration of declarations) {
      const declared = yield* decodeDeclaredIndex({
        kind: "developerOrdered", specVersion: 1, fields: declaration.fields,
      });
      indexes.push(Object.freeze({ ...declaration,
        ref: Object.freeze({ id: declaration.ref.id.slice() }),
        fields: Object.freeze([...declared.fields, "_creationTime"]),
      }));
    }
    return Object.freeze(indexes);
  });
}

/** Validate the whole logical installation before entering the engine owner. */
export const installCoreApplicationSchema = Effect.fn("installCoreApplicationSchema")((
  database: CoreDatabase,
  installation: CoreApplicationSchemaInstallation,
): Effect.Effect<void, CoreError | Schema.SchemaError> => Effect.gen(function* () {
  const tables: CoreTableDefinition[] = [];
  for (const table of installation.tables) {
    const indexes = yield* Effect.fromResult(compileCoreApplicationIndexes(table.indexes));
    tables.push({ name: table.name, number: table.number, tabletId: table.tabletId.slice(), validator: table.validator,
      indexes: [
        { name: "by_id", ref: { id: table.intrinsicIndexes.byId.id.slice() }, fields: [], enabled: true },
        { name: "by_creation_time", ref: { id: table.intrinsicIndexes.byCreationTime.id.slice() },
          fields: ["_creationTime"], enabled: true },
        ...indexes,
      ],
    });
  }
  yield* database.install({ tables, programs: installation.programs,
    ...(installation.authorityEpoch === undefined ? {} : { authorityEpoch: installation.authorityEpoch }),
  });
}));
