function freezeOwnedDeclarativeV2ContractGraph<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) {
      freezeOwnedDeclarativeV2ContractGraph(member);
    }
    Object.freeze(value);
  }
  return value;
}

export const DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1 =
  "flarex.declarative-v2/executable-core/v1" as const;
export const DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_IDENTITY_V1 =
  "flarex.declarative-v2/verifier-asset/v1" as const;
export const DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1 =
  "flarex.declarative-v2/verifier-arena/v1" as const;
export const DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1 =
  "flarex.declarative-v2/verifier-diagnostics/v1" as const;
export const DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1 =
  "unicode/14.0.0/DerivedCoreProperties-ID_Start-ID_Continue" as const;

export const DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1 =
  "FLXDVA1\0" as const;
export const DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1 = 1 as const;
export const DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1 = 8 as const;
export const DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 = 96 as const;
export const DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1 = 24 as const;

export const DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1 = [
  { id: 1, name: "unicodeIdStart", recordBytes: 8 },
  { id: 2, name: "unicodeIdContinue", recordBytes: 8 },
  { id: 3, name: "lexicalRules", recordBytes: 24 },
  { id: 4, name: "grammarRules", recordBytes: 24 },
  { id: 5, name: "valueClasses", recordBytes: 24 },
  { id: 6, name: "operatorRules", recordBytes: 24 },
  { id: 7, name: "operationalRules", recordBytes: 24 },
  { id: 8, name: "capabilityMatrix", recordBytes: 24 },
  { id: 9, name: "abiOperations", recordBytes: 32 },
  { id: 10, name: "diagnostics", recordBytes: 28 },
  { id: 11, name: "failureClasses", recordBytes: 24 },
  { id: 12, name: "arenaWidths", recordBytes: 20 },
  { id: 13, name: "stringPool", recordBytes: 1 },
  { id: 14, name: "canonicalSpecification", recordBytes: 1 },
] as const;

export const DECLARATIVE_V2_CORE_LEXICAL_RULES_V1 = [
  { id: 1, code: "source.utf8", rule: "Input is fatal incremental UTF-8 without BOM or shebang." },
  { id: 2, code: "space.white", rule: "ECMAScript 2022 WhiteSpace and LineTerminator code points are recognized from pinned Unicode 14 tables." },
  { id: 3, code: "comment.line", rule: "Line comments end at an admitted LineTerminator or EOF." },
  { id: 4, code: "comment.block", rule: "Block comments must terminate and do not nest." },
  { id: 5, code: "identifier", rule: "Identifiers use Unicode 14 ID_Start and ID_Continue plus dollar sign, underscore, and ECMAScript escapes." },
  { id: 6, code: "identifier.escape", rule: "Identifier escapes must decode to a code point admitted at the escaped position and never form a reserved word." },
  { id: 7, code: "identifier.private", rule: "Private identifiers are rejected." },
  { id: 8, code: "keyword", rule: "ECMAScript 2022 keywords and contextual words are tokenized by exact grammar position." },
  { id: 9, code: "number.decimal", rule: "Decimal integer and floating literals, separators, exponents, and legacy-free leading zero spelling are admitted." },
  { id: 10, code: "number.radix", rule: "Binary, octal, and hexadecimal numeric and BigInt literals are admitted with ECMAScript separator placement." },
  { id: 11, code: "number.bigint", rule: "BigInt literal suffix is admitted only where ECMAScript 2022 permits it." },
  { id: 12, code: "string", rule: "Single and double quoted strings use ECMAScript escapes; octal escapes and unescaped line terminators are rejected." },
  { id: 13, code: "template", rule: "Untagged templates and substitutions are admitted; tagged templates are rejected." },
  { id: 14, code: "regexp", rule: "The lexical goal distinguishes regular-expression literals from division, but every regular-expression value is rejected by policy." },
  { id: 15, code: "punctuator", rule: "Only ECMAScript 2022 punctuators used by the Core grammar are admitted." },
  { id: 16, code: "optional.chain", rule: "Optional chaining is admitted only when trusted lowering resolves it to value access or an exact direct call." },
  { id: 17, code: "asi", rule: "Automatic semicolon insertion follows restricted ECMAScript productions and LineTerminator sensitivity." },
  { id: 18, code: "truncation", rule: "Malformed or truncated token input fails at the earliest byte position before later grammar work." },
] as const;

export const DECLARATIVE_V2_CORE_GRAMMAR_RULES_V1 = [
  { id: 1, code: "module", rule: "A module is directives, static imports, and direct function declarations only." },
  { id: 2, code: "directive", rule: "Only string-literal directives are admitted before imports and declarations; they carry no runtime authority." },
  { id: 3, code: "import.named", rule: "Artifact-local or allowlisted-platform named imports are admitted with no alias." },
  { id: 4, code: "import.default", rule: "Artifact-local or allowlisted-platform default imports are admitted with no alias." },
  { id: 5, code: "import.namespace", rule: "Namespace imports, side-effect-only imports, import attributes, and dynamic import are rejected." },
  { id: 6, code: "export.namedFunction", rule: "A named function declaration may be exported directly." },
  { id: 7, code: "export.defaultFunction", rule: "A named default function declaration may be exported directly." },
  { id: 8, code: "export.reexport", rule: "Export aliases, export lists, re-exports, export-star, and anonymous default functions are rejected." },
  { id: 9, code: "function", rule: "Named normal and async function declarations are admitted; generators, arrows, methods, and classes are rejected." },
  { id: 10, code: "binding", rule: "Parameters and local let or const bindings use identifiers or bounded array/object destructuring without computed keys." },
  { id: 11, code: "statement", rule: "Blocks, expression statements, declarations, if, switch, loops, return, throw, try, break, and continue are admitted in function bodies." },
  { id: 12, code: "loop", rule: "for, for-of over Core data, while, and do-while are admitted; for-in and async iteration are rejected." },
  { id: 13, code: "try", rule: "try/catch/finally is admitted only for application-owned completions; host-outcome observation is rejected by value-flow verification." },
  { id: 14, code: "expression", rule: "Literals, identifiers, arrays, records, templates, unary, binary, logical, conditional, assignment, sequence, and await are admitted under Core policy." },
  { id: 15, code: "member", rule: "Member syntax is admitted only when trusted lowering resolves it to a value ABI operation; reflective or capability recovery is rejected." },
  { id: 16, code: "call", rule: "Calls resolve statically to a verified local function, admitted direct import, or pinned ABI operation." },
  { id: 17, code: "construction", rule: "new, class construction, function-valued variables, callbacks, bind, call, apply, eval, and function synthesis are rejected." },
  { id: 18, code: "topLevel", rule: "Top-level executable initialization, top-level await, mutable state, and module evaluation effects are rejected." },
  { id: 19, code: "graph", rule: "Artifact-local import paths are canonical, imports are direct, and module cycles are rejected." },
  { id: 20, code: "metadata", rule: "Runtime markers, exporters, computed metadata, and undeclared exports are ignored and carry no V2 authority." },
] as const;

export const DECLARATIVE_V2_CORE_VALUE_CLASSES_V1 = [
  { id: 1, name: "undefined", boundary: "object-omit-only", rule: "Local absence; forbidden at top-level and in arrays." },
  { id: 2, name: "null", boundary: "allowed", rule: "Canonical explicit absence." },
  { id: 3, name: "boolean", boundary: "allowed", rule: "Primitive Boolean." },
  { id: 4, name: "number", boundary: "allowed", rule: "ECMAScript binary64 including special float spellings owned by Flarex Value." },
  { id: 5, name: "bigint", boundary: "signed-int64", rule: "Arbitrary precision locally; exact signed-int64 admission at a Flarex boundary." },
  { id: 6, name: "string", boundary: "well-formed-unicode", rule: "UTF-16 locally; isolated surrogates rejected at a Flarex boundary." },
  { id: 7, name: "bytes", boundary: "owned-bytes", rule: "Owned ordinary ArrayBuffer-backed bytes copied at every authority boundary." },
  { id: 8, name: "array", boundary: "dense-acyclic", rule: "Owned mutable local array; dense and recursively valid at a Flarex boundary." },
  { id: 9, name: "record", boundary: "plain-acyclic", rule: "Owned null-prototype string-keyed data record without accessors or symbols." },
  { id: 10, name: "documentId", boundary: "validated-id", rule: "Opaque validated Flarex document identifier." },
  { id: 11, name: "functionReference", boundary: "canonical-static-path", rule: "Non-executable canonical path usable only by exact nested-call ABI operations." },
  { id: 12, name: "applicationError", boundary: "catchable-core-error", rule: "Canonical code, message, and optional boundary-valid data." },
  { id: 13, name: "authIdentity", boundary: "owned-host-projection", rule: "Owned immutable host projection or null; no host cause or capability is exposed." },
  { id: 14, name: "queryHandle", boundary: "local-linear", rule: "Local non-serializable linear builder state, never a Flarex value." },
  { id: 15, name: "paginationCursor", boundary: "opaque-host-value", rule: "Opaque value accepted only by the paginate ABI and never authority outside that call." },
] as const;

export const DECLARATIVE_V2_CORE_OPERATOR_RULES_V1 = [
  { id: 1, spelling: "literal", operands: "primitive-or-container", rule: "Literal allocation creates owned Core values only." },
  { id: 2, spelling: "typeof", operands: "local-value", rule: "Uses ECMAScript primitive categories; host capabilities are not Core values." },
  { id: 3, spelling: "void", operands: "expression", rule: "Evaluates once and returns local undefined." },
  { id: 4, spelling: "!", operands: "local-value", rule: "Uses ECMAScript truthiness over admitted Core values without user coercion." },
  { id: 5, spelling: "unary-plus", operands: "number", rule: "Admits Number only; BigInt and object coercion fail deterministically." },
  { id: 6, spelling: "unary-minus", operands: "same-numeric-kind", rule: "Uses ECMAScript Number or arbitrary-precision BigInt negation." },
  { id: 7, spelling: "~", operands: "same-numeric-kind", rule: "Uses ToInt32 for Number or arbitrary-precision BigInt complement." },
  { id: 8, spelling: "arithmetic", operands: "same-numeric-kind", rule: "Minus, multiply, divide, remainder, and exponentiation require one numeric kind." },
  { id: 9, spelling: "+", operands: "same-numeric-kind-or-scalar-string", rule: "Numeric addition or primitive scalar string concatenation only." },
  { id: 10, spelling: "bitwise", operands: "same-numeric-kind", rule: "And, or, xor, and signed shifts use the pinned Number or BigInt rules." },
  { id: 11, spelling: ">>>", operands: "number", rule: "Unsigned right shift is Number-only with a modulo-32 shift count." },
  { id: 12, spelling: "relational", operands: "compatible-scalars", rule: "Less, greater, and inclusive forms follow ECMAScript primitive comparison without object coercion." },
  { id: 13, spelling: "=== !==", operands: "local-values", rule: "Strict equality only; containers and errors compare by local reference." },
  { id: 14, spelling: "&& || ??", operands: "local-values", rule: "Preserves left-to-right short-circuiting and returns the selected operand." },
  { id: 15, spelling: "?:", operands: "local-values", rule: "Evaluates exactly one branch after the condition." },
  { id: 16, spelling: "assignment", operands: "verified-local-or-lowered-access", rule: "Simple and compound assignments capture operands once and preserve aliases." },
  { id: 17, spelling: "++ --", operands: "verified-numeric-local", rule: "Preserves prefix or postfix result with same-kind numeric arithmetic." },
  { id: 18, spelling: "delete", operands: "lowered-value-access", rule: "Only trusted lowering to valueDelete is admitted." },
  { id: 19, spelling: "in instanceof == !=", operands: "none", rule: "Rejected because prototype, constructor, or coercion semantics are outside Core V1." },
  { id: 20, spelling: "comma", operands: "expressions", rule: "Evaluates left to right and returns the final result." },
] as const;

export const DECLARATIVE_V2_CORE_OPERATIONAL_RULES_V1 = [
  {
    id: 1,
    code: "undefined.local",
    category: "value",
    rule:
      "undefined is legal for local bindings, missing own properties, absent local arguments, bare return, and void.",
  },
  {
    id: 2,
    code: "undefined.boundary",
    category: "boundary",
    rule:
      "Flarex object properties whose value is undefined are omitted; top-level and array undefined are rejected; handler undefined becomes null.",
  },
  {
    id: 3,
    code: "number.binary64",
    category: "numeric",
    rule:
      "Number operations use ECMAScript 2022 binary64 semantics including NaN, infinities, and signed zero.",
  },
  {
    id: 4,
    code: "number.divide",
    category: "numeric",
    rule:
      "Number division or remainder by zero produces the ECMAScript binary64 result and is not an application error.",
  },
  {
    id: 5,
    code: "number.bitwise",
    category: "numeric",
    rule:
      "Number bitwise operands use ToInt32 or ToUint32 and shift counts are masked modulo 32.",
  },
  {
    id: 6,
    code: "bigint.local",
    category: "numeric",
    rule:
      "Local BigInt is arbitrary precision and never wraps, truncates, or saturates to signed int64.",
  },
  {
    id: 7,
    code: "bigint.boundary",
    category: "boundary",
    rule:
      "A BigInt crossing a Flarex value boundary must fit signed int64 or produces a catchable value-boundary rejection.",
  },
  {
    id: 8,
    code: "bigint.divide",
    category: "numeric",
    rule:
      "BigInt division truncates toward zero; remainder has the dividend sign; zero divisor and negative exponent are catchable range failures.",
  },
  {
    id: 9,
    code: "bigint.shift",
    category: "numeric",
    rule:
      "BigInt signed shifts use ECMAScript arbitrary-precision semantics; unsigned right shift is unsupported.",
  },
  {
    id: 10,
    code: "numeric.mixed",
    category: "numeric",
    rule:
      "Mixed Number and BigInt strict equality and relational comparisons follow ECMAScript; mixed arithmetic, exponentiation, and bitwise work is rejected or fails catchably.",
  },
  {
    id: 11,
    code: "addition.scalar",
    category: "operator",
    rule:
      "Addition is same-kind numeric addition or scalar string concatenation; any value requiring object coercion is rejected.",
  },
  {
    id: 12,
    code: "equality.strict",
    category: "operator",
    rule:
      "Only strict equality and inequality are admitted; containers, bytes, and Core errors compare by local reference identity.",
  },
  {
    id: 13,
    code: "coercion.object",
    category: "operator",
    rule:
      "Prototype, getter, symbol, or user-code coercion is forbidden; lowering must preserve proven scalar semantics or emit a diagnostic.",
  },
  {
    id: 14,
    code: "evaluation.order",
    category: "operator",
    rule:
      "Expressions evaluate left to right and lowering captures base, key, and value exactly once before an ABI mutation.",
  },
  {
    id: 15,
    code: "logical.shortCircuit",
    category: "operator",
    rule:
      "Logical and, logical or, nullish coalescing, conditional, and logical assignment preserve ECMAScript short-circuiting.",
  },
  {
    id: 16,
    code: "container.owned",
    category: "container",
    rule:
      "Core containers are owned null-prototype data containers without accessors, symbols, proxies, or inherited properties.",
  },
  {
    id: 17,
    code: "container.alias",
    category: "container",
    rule:
      "Local assignment may create aliases and mutations are observed by every alias; wire boundaries do not preserve caller-side alias identity.",
  },
  {
    id: 18,
    code: "container.get",
    category: "container",
    rule:
      "valueGet reads only an own data property; a missing property or array hole returns undefined.",
  },
  {
    id: 19,
    code: "container.has",
    category: "container",
    rule:
      "valueHas distinguishes a missing property from an own property whose value is undefined.",
  },
  {
    id: 20,
    code: "container.set",
    category: "container",
    rule:
      "valueSet mutates the captured owned container in place and returns the assigned value.",
  },
  {
    id: 21,
    code: "container.delete",
    category: "container",
    rule:
      "valueDelete mutates in place and returns true for an existing configurable Core property or an absent property; deleting an array item leaves a hole.",
  },
  {
    id: 22,
    code: "array.resize",
    category: "container",
    rule:
      "valueResizeArray mutates the same array; shrink removes tail items and growth creates holes; length must be uint32-compatible.",
  },
  {
    id: 23,
    code: "container.spread",
    category: "container",
    rule:
      "Object spread copies own enumerable string data properties; array spread returns a fresh dense array and converts holes to undefined.",
  },
  {
    id: 24,
    code: "container.proto",
    category: "container",
    rule:
      "Prototype-setting object-literal syntax is rejected; the string __proto__ may only be an ordinary own key on a null-prototype container.",
  },
  {
    id: 25,
    code: "container.boundary",
    category: "boundary",
    rule:
      "Flarex serialization copies logical values, omits object undefined, rejects sparse or undefined arrays, and rejects cycles.",
  },
  {
    id: 26,
    code: "bytes.owned",
    category: "bytes",
    rule:
      "Byte values are owned mutable ordinary ArrayBuffer storage; shared, detached, proxy, and caller-authority representations are forbidden.",
  },
  {
    id: 27,
    code: "bytes.mutation",
    category: "bytes",
    rule:
      "bytesSet mutates aliases; bytesSlice and bytesConcat allocate fresh storage; invalid indices or byte values fail catchably.",
  },
  {
    id: 28,
    code: "string.utf16",
    category: "string",
    rule:
      "Runtime strings use ECMAScript UTF-16 code-unit indexing and length with no normalization or locale-dependent behavior.",
  },
  {
    id: 29,
    code: "string.source",
    category: "string",
    rule:
      "Source bytes use fatal incremental UTF-8; escapes may create isolated surrogates locally but the Flarex boundary rejects them.",
  },
  {
    id: 30,
    code: "string.codePoint",
    category: "string",
    rule:
      "codePointAt and fromCodePoint use ECMAScript scalar and surrogate behavior; invalid fromCodePoint input is catchable.",
  },
  {
    id: 31,
    code: "functions.direct",
    category: "function",
    rule:
      "Every call target resolves statically to a verified local function, admitted direct import, or exact pinned platform ABI operation.",
  },
  {
    id: 32,
    code: "functions.await",
    category: "function",
    rule:
      "await is admitted only for a statically resolved asynchronous local, import, or ABI call.",
  },
  {
    id: 33,
    code: "functions.references",
    category: "function",
    rule:
      "Function references are canonical literal paths and are never first-class executable values.",
  },
  {
    id: 34,
    code: "errors.payload",
    category: "failure",
    rule:
      "throw accepts only CoreApplicationErrorV1 with canonical code, message, and optional data; arbitrary throw payloads are rejected.",
  },
  {
    id: 35,
    code: "errors.catch",
    category: "failure",
    rule:
      "Application catch observes only explicit Core application errors and ABI failures declared catchable by this version.",
  },
  {
    id: 36,
    code: "errors.finally",
    category: "failure",
    rule:
      "Application-only return, throw, break, continue, catch, and finally use ECMAScript completion ordering.",
  },
  {
    id: 37,
    code: "errors.host",
    category: "failure",
    rule:
      "Host Effect failure, defect, interruption, timeout, uncertainty, and full Cause are uncatchable and cannot be suppressed by application catch or finally.",
  },
  {
    id: 38,
    code: "errors.hostDependency",
    category: "failure",
    rule:
      "Trusted lowering rejects code whose correctness depends on catch or finally observing, completing around, or suppressing a host-owned operation outcome.",
  },
  {
    id: 39,
    code: "errors.cause",
    category: "failure",
    rule:
      "Native cause identity, stack, transport evidence, secrets, persistence evidence, and Effect Cause never become Core values.",
  },
  {
    id: 40,
    code: "authority.metadata",
    category: "authority",
    rule:
      "Runtime markers, exporters, undeclared exports, and application execution carry no Declarative V2 metadata authority.",
  },
  {
    id: 41,
    code: "authority.partition",
    category: "authority",
    rule:
      "Partition selection is authoritative declarative metadata, not an executable Core value or ABI operation; database calls consume only the verified declared context.",
  },
  {
    id: 42,
    code: "authority.schemaValidator",
    category: "authority",
    rule:
      "Schema and validator projections derive only from canonical semantic declarations; runtime schema or validator exporters are ignored and unavailable to the Core ABI.",
  },
  {
    id: 43,
    code: "failure.mixedAbi",
    category: "failure",
    rule:
      "For a mixed ABI operation, deterministic argument, validation, range, and declared domain rejection is application-catchable; resource, protocol, budget, timeout, uncertainty, defect, interruption, and full Cause remain host-owned and uncatchable.",
  },
] as const;

export const DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1 = [
  {
    id: 1,
    functionKind: "query",
    auth: true,
    databaseRead: true,
    databaseWrite: false,
    runQuery: true,
    runMutation: false,
  },
  {
    id: 2,
    functionKind: "mutation",
    auth: true,
    databaseRead: true,
    databaseWrite: true,
    runQuery: true,
    runMutation: true,
  },
  {
    id: 3,
    functionKind: "workflowMutation",
    auth: true,
    databaseRead: true,
    databaseWrite: true,
    runQuery: true,
    runMutation: true,
  },
  {
    id: 4,
    functionKind: "action",
    auth: true,
    databaseRead: false,
    databaseWrite: false,
    runQuery: true,
    runMutation: true,
  },
] as const;

export const DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1 = [
  { id: 1, name: "valueGet", capability: "data", catchability: "application", semantics: "own data read" },
  { id: 2, name: "valueHas", capability: "data", catchability: "application", semantics: "own presence test" },
  { id: 3, name: "valueSet", capability: "data", catchability: "application", semantics: "in-place own data write" },
  { id: 4, name: "valueDelete", capability: "data", catchability: "application", semantics: "in-place own deletion" },
  { id: 5, name: "valueResizeArray", capability: "data", catchability: "application", semantics: "in-place uint32 array resize" },
  { id: 6, name: "valueOwnKeys", capability: "data", catchability: "application", semantics: "own enumerable string keys" },
  { id: 7, name: "valueSpreadObject", capability: "data", catchability: "application", semantics: "fresh null-prototype copy" },
  { id: 8, name: "valueSpreadArray", capability: "data", catchability: "application", semantics: "fresh dense copy" },
  { id: 9, name: "bytesGet", capability: "data", catchability: "application", semantics: "owned byte read" },
  { id: 10, name: "bytesSet", capability: "data", catchability: "application", semantics: "owned byte write" },
  { id: 11, name: "bytesSlice", capability: "data", catchability: "application", semantics: "fresh byte slice" },
  { id: 12, name: "bytesConcat", capability: "data", catchability: "application", semantics: "fresh byte concatenation" },
  { id: 13, name: "stringCodePointAt", capability: "data", catchability: "application", semantics: "ECMAScript codePointAt" },
  { id: 14, name: "stringFromCodePoint", capability: "data", catchability: "application", semantics: "ECMAScript fromCodePoint" },
  { id: 15, name: "scalarToString", capability: "data", catchability: "application", semantics: "primitive-only canonical spelling" },
  { id: 16, name: "sameValue", capability: "data", catchability: "application", semantics: "ECMAScript SameValue" },
  { id: 17, name: "sameValueZero", capability: "data", catchability: "application", semantics: "ECMAScript SameValueZero" },
  { id: 18, name: "errorCreate", capability: "applicationError", catchability: "application", semantics: "create CoreApplicationErrorV1" },
  { id: 19, name: "errorCode", capability: "applicationError", catchability: "application", semantics: "read canonical error code" },
  { id: 20, name: "errorMessage", capability: "applicationError", catchability: "application", semantics: "read canonical error message" },
  { id: 21, name: "errorData", capability: "applicationError", catchability: "application", semantics: "read optional error data" },
  { id: 22, name: "authGetUserIdentity", capability: "auth", catchability: "host", semantics: "return owned identity or null" },
  { id: 23, name: "databaseGet", capability: "databaseRead", catchability: "mixed", semantics: "get one document or null" },
  { id: 24, name: "queryStart", capability: "databaseRead", catchability: "application", semantics: "start typed table query" },
  { id: 25, name: "rangeEq", capability: "databaseRead", catchability: "application", semantics: "ordered equality prefix" },
  { id: 26, name: "rangeGt", capability: "databaseRead", catchability: "application", semantics: "exclusive lower bound" },
  { id: 27, name: "rangeGte", capability: "databaseRead", catchability: "application", semantics: "inclusive lower bound" },
  { id: 28, name: "rangeLt", capability: "databaseRead", catchability: "application", semantics: "exclusive upper bound" },
  { id: 29, name: "rangeLte", capability: "databaseRead", catchability: "application", semantics: "inclusive upper bound" },
  { id: 30, name: "queryWithIndex", capability: "databaseRead", catchability: "application", semantics: "bind exact declared index and range" },
  { id: 31, name: "queryOrder", capability: "databaseRead", catchability: "application", semantics: "asc or desc, last call wins" },
  { id: 32, name: "queryCollect", capability: "databaseRead", catchability: "mixed", semantics: "collect query page" },
  { id: 33, name: "queryTake", capability: "databaseRead", catchability: "mixed", semantics: "take bounded count" },
  { id: 34, name: "queryFirst", capability: "databaseRead", catchability: "mixed", semantics: "take one then value or null" },
  { id: 35, name: "queryUnique", capability: "databaseRead", catchability: "mixed", semantics: "take two then fail catchably if multiple" },
  { id: 36, name: "queryPaginate", capability: "databaseRead", catchability: "mixed", semantics: "bounded page and continuation cursor" },
  { id: 37, name: "databaseInsert", capability: "databaseWrite", catchability: "mixed", semantics: "insert validated document" },
  { id: 38, name: "databasePatch", capability: "databaseWrite", catchability: "mixed", semantics: "patch validated document" },
  { id: 39, name: "databaseReplace", capability: "databaseWrite", catchability: "mixed", semantics: "replace validated document" },
  { id: 40, name: "databaseDelete", capability: "databaseWrite", catchability: "mixed", semantics: "delete document" },
  { id: 41, name: "runQuery", capability: "nestedCall", catchability: "mixed", semantics: "invoke exact static query reference" },
  { id: 42, name: "runMutation", capability: "nestedCall", catchability: "mixed", semantics: "invoke exact static mutation reference" },
] as const;

export const DECLARATIVE_V2_CORE_FAILURE_CLASSES_V1 = [
  { id: 1, code: "application.throw", owner: "application", catchable: true, rule: "explicit CoreApplicationErrorV1" },
  { id: 2, code: "application.numeric", owner: "application", catchable: true, rule: "defined numeric type or range failure" },
  { id: 3, code: "application.value", owner: "application", catchable: true, rule: "defined value, validator, or document rejection" },
  { id: 4, code: "application.unique", owner: "application", catchable: true, rule: "query unique observed multiple documents" },
  { id: 5, code: "host.protocol", owner: "host", catchable: false, rule: "protocol or release identity mismatch" },
  { id: 6, code: "host.corruption", owner: "host", catchable: false, rule: "authenticated evidence missing or corrupt" },
  { id: 7, code: "host.resource", owner: "host", catchable: false, rule: "service, R2, database, or transport resource failure" },
  { id: 8, code: "host.persistence", owner: "host", catchable: false, rule: "stale fence, rollback, OCC, or decision uncertainty" },
  { id: 9, code: "host.budget", owner: "host", catchable: false, rule: "verification or execution budget and timeout" },
  { id: 10, code: "host.interruption", owner: "host", catchable: false, rule: "interruption or cancellation with full Cause" },
  { id: 11, code: "host.defect", owner: "host", catchable: false, rule: "invariant failure or unexpected foreign failure identity" },
] as const;

export const DECLARATIVE_V2_CORE_DIAGNOSTICS_V1 = [
  { id: 1, code: "CORE_INVALID_UTF8", phase: "source", order: 1, rule: "fatal UTF-8 decoding failed" },
  { id: 2, code: "CORE_TRUNCATED_TOKEN", phase: "lexical", order: 2, rule: "token ended before a required delimiter" },
  { id: 3, code: "CORE_UNSUPPORTED_TOKEN", phase: "lexical", order: 3, rule: "lexical form is outside Core V1" },
  { id: 4, code: "CORE_SYNTAX", phase: "parse", order: 4, rule: "grammar production is invalid" },
  { id: 5, code: "CORE_DYNAMIC_IMPORT", phase: "parse", order: 5, rule: "dynamic import is forbidden" },
  { id: 6, code: "CORE_SIDE_EFFECT_IMPORT", phase: "parse", order: 6, rule: "side-effect-only import is forbidden" },
  { id: 7, code: "CORE_REEXPORT", phase: "parse", order: 7, rule: "aliases, re-export, and export-star are forbidden" },
  { id: 8, code: "CORE_TOP_LEVEL_EXECUTION", phase: "parse", order: 8, rule: "top-level executable initialization is forbidden" },
  { id: 9, code: "CORE_CONSTRUCTION", phase: "parse", order: 9, rule: "construction and classes are forbidden" },
  { id: 10, code: "CORE_COMPUTED_DISPATCH", phase: "parse", order: 10, rule: "computed or reflective dispatch was not safely lowered" },
  { id: 11, code: "CORE_HIGHER_ORDER", phase: "parse", order: 11, rule: "higher-order executable values and callbacks are forbidden" },
  { id: 12, code: "CORE_DYNAMIC_CODE", phase: "parse", order: 12, rule: "eval, Function, or equivalent synthesis is forbidden" },
  { id: 13, code: "CORE_REGEXP_UNSUPPORTED", phase: "parse", order: 13, rule: "regular-expression runtime objects are not admitted" },
  { id: 14, code: "CORE_LOOSE_EQUALITY", phase: "parse", order: 14, rule: "loose equality is forbidden" },
  { id: 15, code: "CORE_THROW_PAYLOAD", phase: "parse", order: 15, rule: "throw payload is not CoreApplicationErrorV1" },
  { id: 16, code: "CORE_HOST_FAILURE_OBSERVATION", phase: "valueFlow", order: 16, rule: "catch or finally depends on observing a host-owned outcome" },
  { id: 17, code: "CORE_UNSAFE_COERCION", phase: "valueFlow", order: 17, rule: "operator requires forbidden object or capability coercion" },
  { id: 18, code: "CORE_NUMERIC_KIND", phase: "valueFlow", order: 18, rule: "numeric kinds are statically incompatible" },
  { id: 19, code: "CORE_CAPABILITY_CONTEXT", phase: "valueFlow", order: 19, rule: "operation is unavailable in the declared function kind" },
  { id: 20, code: "CORE_CALL_TARGET", phase: "link", order: 20, rule: "call target is not an exact verified target" },
  { id: 21, code: "CORE_IMPORT_TARGET", phase: "link", order: 21, rule: "import is neither artifact-local nor allowlisted" },
  { id: 22, code: "CORE_EXPORT_AMBIGUITY", phase: "link", order: 22, rule: "declared export is ambiguous" },
  { id: 23, code: "CORE_MODULE_CYCLE", phase: "link", order: 23, rule: "module graph contains a cycle" },
  { id: 24, code: "CORE_HANDLER_MISSING", phase: "registration", order: 24, rule: "declared handler has no exact verified export" },
  { id: 25, code: "CORE_HANDLER_KIND", phase: "registration", order: 25, rule: "verified handler kind is incompatible with declaration" },
  { id: 26, code: "CORE_BUDGET", phase: "admission", order: 26, rule: "a required dimension exceeds its caller ceiling" },
  { id: 27, code: "CORE_ADDRESSABILITY", phase: "admission", order: 27, rule: "fixed-width arena cannot address the admitted work" },
  { id: 28, code: "CORE_DIAGNOSTIC_BUDGET", phase: "diagnostic", order: 28, rule: "diagnostic bytes cannot be admitted before allocation" },
] as const;

export const DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1 = [
  { id: 1, name: "tokenRecord", bytes: 56, dimension: "tokens" },
  { id: 2, name: "parserStateRecord", bytes: 24, dimension: "parserStates" },
  { id: 3, name: "nestingRecord", bytes: 16, dimension: "nestingDepth" },
  { id: 4, name: "moduleRecord", bytes: 64, dimension: "modules" },
  { id: 5, name: "importEdgeRecord", bytes: 64, dimension: "importEdges" },
  { id: 6, name: "exportRecord", bytes: 48, dimension: "exports" },
  { id: 7, name: "functionRecord", bytes: 144, dimension: "functions" },
  { id: 8, name: "schemaNodeRecord", bytes: 32, dimension: "schemaNodes" },
  { id: 9, name: "validatorNodeRecord", bytes: 32, dimension: "validatorNodes" },
  { id: 10, name: "graphNodeRecord", bytes: 64, dimension: "graphNodes" },
  { id: 11, name: "frontierRecord", bytes: 32, dimension: "frontierEntries" },
] as const;

export const DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1 = [
  { id: 1, dimension: "objectBodyBytes", factor: 3 },
  { id: 2, dimension: "tokenBytes", factor: 1 },
  { id: 3, dimension: "stringBytes", factor: 1 },
  { id: 4, dimension: "canonicalBytes", factor: 2 },
  { id: 5, dimension: "frameBytes", factor: 2 },
  { id: 6, dimension: "diagnosticBytes", factor: 2 },
  { id: 7, dimension: "outputBytes", factor: 2 },
] as const;

export const DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1 =
  freezeOwnedDeclarativeV2ContractGraph({
  executableCoreIdentity: DECLARATIVE_V2_EXECUTABLE_CORE_IDENTITY_V1,
  assetFormatIdentity: DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_IDENTITY_V1,
  arenaIdentity: DECLARATIVE_V2_VERIFIER_ARENA_IDENTITY_V1,
  diagnosticIdentity: DECLARATIVE_V2_VERIFIER_DIAGNOSTIC_IDENTITY_V1,
  unicodeIdentity: DECLARATIVE_V2_VERIFIER_UNICODE_IDENTITY_V1,
  language: {
    ecmaEdition: 2022,
    unicodeVersion: "14.0.0",
    sourceEncoding: "fatal-incremental-utf8",
    moduleMode: "restricted-static-esm",
    runtimeMetadataAuthority: false,
    undeclaredExports: "ignored",
    sourcePositions: "omitted",
  },
  lexicalRules: DECLARATIVE_V2_CORE_LEXICAL_RULES_V1,
  grammarRules: DECLARATIVE_V2_CORE_GRAMMAR_RULES_V1,
  valueClasses: DECLARATIVE_V2_CORE_VALUE_CLASSES_V1,
  operatorRules: DECLARATIVE_V2_CORE_OPERATOR_RULES_V1,
  operationalRules: DECLARATIVE_V2_CORE_OPERATIONAL_RULES_V1,
  capabilityMatrix: DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1,
  abiOperations: DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1,
  failureClasses: DECLARATIVE_V2_CORE_FAILURE_CLASSES_V1,
  diagnostics: DECLARATIVE_V2_CORE_DIAGNOSTICS_V1,
  arena: {
    baseBytes: 12_544,
    addressWidthBits: 32,
    counterWidthBits: 64,
    generatedTableResidency:
      "one immutable fixed asset outside the caller-proportional request arena",
    tableBytesAccounting:
      "precharged bytes visited while loading or consulting the generated asset; never a hidden AST or graph allocation",
    widths: DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1,
    byteFactors: DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1,
  },
  asset: {
    magic: DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1,
    formatVersion: DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1,
    alignment: DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1,
    headerBytes: DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1,
    sectionEntryBytes: DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1,
    sections: DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1,
  },
  } as const);
