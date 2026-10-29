import { defineModule, query, sourceModule, v } from "@flarex/application-definition";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from "flarex-backend/artifact-runtime";
const COMPATIBILITY_DATE = "2026-06-14";

export const USERS_GET_REFERENCE = defineModule({
  path: "users",
  source: sourceModule({
    path: "functions/users.js",
    bytes: new TextEncoder().encode("export {};\n"),
  }),
  functions: {
    get: query({
      args: v.object({ id: v.string() }),
      returns: v.object({
        _id: v.string(),
        _creationTime: v.number(),
        name: v.string(),
      }),
    }),
  },
}).reference("get");

export const USERS_GET_MISMATCH_REFERENCE = defineModule({
  path: "users",
  source: sourceModule({
    path: "functions/users-mismatch.js",
    bytes: new TextEncoder().encode("export {};\n"),
  }),
  functions: {
    get: query({
      args: v.object({ id: v.string() }),
      returns: v.boolean(),
    }),
  },
}).reference("get");

const CACHE_DOCUMENT = v.object({ _id: v.string(), _creationTime: v.number(), name: v.string(), padding: v.optional(v.string()) });
const CACHE_POINT = v.union(CACHE_DOCUMENT, v.null());
const CACHE_PAGE = v.object({ documents: v.array(CACHE_DOCUMENT), isDone: v.boolean() });
const CACHE_ARGUMENTS = v.object({ repeatId: v.string(), missingId: v.string(), suffixId: v.string(),
  invertedBounds: v.optional(v.union(v.literal("cold"), v.literal("warm"))),
  bounds: v.object({ startInclusive: v.optional(v.string()), endExclusive: v.optional(v.string()) }) });
export const USERS_CACHE_REFERENCE = defineModule({
  path: "users",
  source: sourceModule({ path: "functions/users.js", bytes: new TextEncoder().encode("export {};\n") }),
  functions: {
    cacheProbe: query({
      args: CACHE_ARGUMENTS,
      returns: v.object({ first: CACHE_POINT, repeated: CACHE_POINT, missing: CACHE_POINT, missingRepeated: CACHE_POINT,
        limited: CACHE_PAGE, fromRange: CACHE_POINT, expanded: CACHE_PAGE, afterExpanded: CACHE_POINT,
        covered: CACHE_PAGE, bounded: CACHE_PAGE, boundedLimited: CACHE_PAGE, repeatedRange: CACHE_PAGE }),
    }),
  },
}).reference("cacheProbe");
export const USERS_CACHE_MISMATCH_REFERENCE = defineModule({
  path: "users",
  source: sourceModule({ path: "functions/users-cache-mismatch.js", bytes: new TextEncoder().encode("export {};\n") }),
  functions: { cacheProbe: query({ args: CACHE_ARGUMENTS, returns: v.boolean() }) },
}).reference("cacheProbe");

export const CACHE_ROW_A = decodeAppRowIdHexV1("11".repeat(16));
export const CACHE_ROW_B = decodeAppRowIdHexV1("22".repeat(16));
export const CACHE_ROW_C = decodeAppRowIdHexV1("33".repeat(16));
export const CACHE_ROW_MISSING = decodeAppRowIdHexV1("44".repeat(16));

export const APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
  compatibilityDate: COMPATIBILITY_DATE,
});

export const APPLICATION_NATIVE_QUERY_CACHE_FIXTURE_OPTIONS = Object.freeze({
  ...APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
  includeUserNameIndex: true,
  includeQueryCacheProbe: true,
  initialUserDocuments: Object.freeze([
    Object.freeze({ name: "Ada", rowId: CACHE_ROW_A }),
    Object.freeze({ name: "Ada", rowId: CACHE_ROW_B }),
    Object.freeze({ name: "Bea", rowId: CACHE_ROW_C }),
  ]),
});
