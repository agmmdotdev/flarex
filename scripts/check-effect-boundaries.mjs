#!/usr/bin/env node
// @ts-check
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

/**
 * @typedef {{
 *   namespaces: Set<string>;
 *   runPromise: Set<string>;
 *   runSync: Set<string>;
 * }} EffectBindings
 *
 * @typedef {{
 *   relativePath: string;
 *   text: string;
 *   scriptKind?: ts.ScriptKind;
 * }} SourceInput
 *
 * @typedef {{
 *   runSyncMatches: string[];
 *   runPromiseSiteCounts: Map<string, number>;
 *   forbiddenAliasMatches: string[];
 *   forbiddenRuntimeImportMatches: string[];
 * }} BoundaryState
 *
 * @typedef {{
 *   errors: string[];
 *   runSyncMatches: string[];
 *   runPromiseSiteCounts: Map<string, number>;
 *   forbiddenAliasMatches: string[];
 *   forbiddenRuntimeImportMatches: string[];
 * }} BoundaryReport
 */

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "packages");
const productionSourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** @type {Map<string, number>} */
const allowedRunPromiseSites = new Map([
  [siteKey("packages/executor-http/src/liveQueryDelivery.ts", "runFlarexBackendLiveQueryPromise"), 1],
  [siteKey("packages/executor-http/src/routeEffects.ts", "handleExecutorHttpDecodedBody"), 1],
  [siteKey("packages/executor/src/transactionGrant.ts", "verify"), 1],
  [siteKey("packages/flarex-backend/src/artifactRuntime.ts", "ServiceBindingExecutionArtifactRuntime.invoke"), 1],
  [siteKey("packages/flarex-backend/src/artifactRuntime.ts", "fetch"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "requireProjectId"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "runConnectionRoute"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "runConnectionWebSocketMessage"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "resolveSyncAuthenticateIdentity"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "DeliveryDO.alarm"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "DeliveryDO.wakeEffect"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "runDeliveryRoute"), 1],
  [siteKey("packages/flarex-backend/src/deployment/InternalRouteBoundary.ts", "runDeploymentDurableObjectRoute"), 1],
  [siteKey("packages/flarex-backend/src/executionDO.ts", "runExecutionRoute"), 1],
  [siteKey("packages/flarex-backend/src/invoke.ts", "executeInvoke"), 1],
  [siteKey("packages/flarex-backend/src/invoke.ts", "invokeDatabaseOperation"), 1],
  [siteKey("packages/flarex-backend/src/invoke.ts", "loadActiveDeployment"), 1],
  [siteKey("packages/flarex-backend/src/invoke.ts", "loadActiveFunctionMetadata"), 1],
  [siteKey("packages/flarex-backend/src/liveQueryDelivery.ts", "deliverLiveQueryChangesToConnections"), 1],
  [siteKey("packages/flarex-backend/src/partitionDO.ts", "runPartitionRoute"), 1],
  [siteKey("packages/flarex-backend/src/partitionDO.ts", "runPartitionStorageTransactionEffect"), 1],
  [siteKey("packages/flarex-backend/src/registry/InternalRouteBoundary.ts", "runRegistryDurableObjectRoute"), 1],
  [siteKey("packages/flarex-backend/src/scheduler/InternalRouteBoundary.ts", "runSchedulerRoute"), 1],
  [siteKey("packages/flarex-backend/src/schedulerDO.ts", "SchedulerDO.alarm"), 1],
  [siteKey("packages/flarex-backend/src/transaction.ts", "runTransactionOperation"), 1],
  [siteKey("packages/flarex-backend/src/worker.ts", "route"), 1],
  [siteKey("packages/flarex-dev/src/analyze.ts", "analyzeFunctionModules"), 1],
  [siteKey("packages/flarex-dev/src/analyze.ts", "analyzeSourcePackageLocally"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "HttpBackendPushCoordinator.post"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "HttpBackendPushCoordinator.postFinish"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "HttpBackendSourceAnalyzer.analyze"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "LocalBackendPushCoordinator.finish"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "createLocalAnalyzerService"), 1],
  [siteKey("packages/flarex-dev/src/backendPush.ts", "postLocalBackendPush"), 1],
  [siteKey("packages/flarex-dev/src/dev.ts", "fetch"), 1],
  [siteKey("packages/flarex-dev/src/executionArtifact.ts", "LocalMiniflareExecutionArtifactAdapter.analyzeWithDiagnostics"), 1],
  [siteKey("packages/flarex-dev/src/executionArtifact.ts", "LocalMiniflareExecutionArtifactRuntime.invoke"), 1],
  [siteKey("packages/flarex-dev/src/executionArtifact.ts", "analysisWorkerSource <generated:analyze>"), 1],
  [siteKey("packages/flarex-dev/src/runtimeMaterializer.ts", "LocalMiniflareMaterializedExecutionArtifact.executeQuerySession"), 1],
  [siteKey("packages/flarex-dev/src/runtimeMaterializer.ts", "LocalMiniflareMaterializedExecutionArtifact.invoke"), 1],
  [siteKey("packages/flarex-protocol/src/auth.ts", "decodeAuthConfigPromise"), 1],
  [siteKey("packages/persistence-postgres/src/appSchemaPublication.ts", "runPreparedAppSchemaPublicationTransactionEffect"), 1],
  [siteKey("packages/persistence-postgres/src/appTableDefinitionsArtifacts.ts", "runPreparedAppTableDefinitionsArtifactTransactionEffect"), 1],
  [siteKey("packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts", "runRegistrationTransactionAttempt"), 1],
  [siteKey("packages/persistence-postgres/src/indexBuildReconciliation.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/applicationRevisionReadinessV1.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/applicationRevisionActivationV1.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/applicationPointQuerySnapshotV1.ts", "startReadTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/intrinsicCreationTimeIndexBuildV1.ts", "startIntrinsicCreationTimeIndexBuildTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/runtimePersistence.ts", "ensureAppTableDefinitionsArtifactV1"), 1],
  [siteKey("packages/persistence-postgres/src/runtimePersistence.ts", "publishAppSchemaV1"), 1],
  [siteKey("packages/persistence-postgres/src/postgresRuntime.ts", "runPostgresTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/scopeAuthorizationEpochAuthority.ts", "runScopeAuthorizationEpochEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/stableTableCatalog.ts", "runStableTableCatalogEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/transactionSessionActivation.ts", "runExactRunningAttemptEffectTransaction"), 1],
]);

if (isCliEntrypoint()) {
  const productionSourceFiles = Array.from(walk(sourceRoot))
    .filter(isSupportedProductionSourceFile)
    .filter(file => normalizePath(file).includes("/src/"))
    .filter(file => !normalizePath(file).includes("/test/"));
  const report = analyzeEffectRuntimeBoundaries(
    productionSourceFiles.map(file => ({
      relativePath: normalizePath(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
      scriptKind: scriptKindForPath(file),
    })),
  );

  if (report.errors.length > 0) {
    console.error(report.errors.join("\n\n"));
    process.exitCode = 1;
  } else {
    console.log("Effect runtime boundary check passed.");
    console.log(`Production Effect.runSync occurrences: 0`);
    console.log(`Allowed production Effect.runPromise sites: ${allowedRunPromiseSites.size}`);
  }
}

/**
 * @param {SourceInput[]} sources
 * @param {Map<string, number>} allowedSites
 * @returns {BoundaryReport}
 */
export function analyzeEffectRuntimeBoundaries(sources, allowedSites = allowedRunPromiseSites) {
  /** @type {BoundaryState} */
  const state = {
    runSyncMatches: [],
    runPromiseSiteCounts: new Map(),
    forbiddenAliasMatches: [],
    forbiddenRuntimeImportMatches: [],
  };
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.relativePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      source.scriptKind ?? scriptKindForPath(source.relativePath),
    );
    collectEffectRuntimeBoundaries(sourceFile, source.relativePath, state);
  }

  /** @type {string[]} */
  const errors = [];

  if (state.runSyncMatches.length > 0) {
    errors.push(
      [
        "Production source must not use Effect.runSync.",
        ...state.runSyncMatches.map(match => `  - ${match}`),
      ].join("\n"),
    );
  }

  if (state.forbiddenAliasMatches.length > 0) {
    errors.push(
      [
        "Production source must not alias Effect runtime APIs; import/use Effect directly at audited boundaries.",
        ...state.forbiddenAliasMatches.map(match => `  - ${match}`),
      ].join("\n"),
    );
  }

  if (state.forbiddenRuntimeImportMatches.length > 0) {
    errors.push(
      [
        "Production source must not import Effect runtime APIs directly; use Effect.runPromise at audited boundaries.",
        ...state.forbiddenRuntimeImportMatches.map(match => `  - ${match}`),
      ].join("\n"),
    );
  }

  for (const [boundarySite, count] of state.runPromiseSiteCounts) {
    const expected = allowedSites.get(boundarySite);
    if (expected === undefined) {
      errors.push(`Unexpected production Effect.runPromise boundary at ${boundarySite} (${count}).`);
    } else if (expected !== count) {
      errors.push(
        `Production Effect.runPromise boundary count changed at ${boundarySite}: expected ${expected}, found ${count}.`,
      );
    }
  }

  for (const [boundarySite, expected] of allowedSites) {
    if (!state.runPromiseSiteCounts.has(boundarySite)) {
      errors.push(
        `Allowed production Effect.runPromise boundary is missing at ${boundarySite}: expected ${expected}.`,
      );
    }
  }

  return {
    errors,
    runSyncMatches: state.runSyncMatches,
    runPromiseSiteCounts: state.runPromiseSiteCounts,
    forbiddenAliasMatches: state.forbiddenAliasMatches,
    forbiddenRuntimeImportMatches: state.forbiddenRuntimeImportMatches,
  };
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {string} relativePath
 * @param {BoundaryState} state
 */
function collectEffectRuntimeBoundaries(sourceFile, relativePath, state) {
  const effectBindings = collectEffectBindings(sourceFile);
  collectForbiddenRuntimeImports(sourceFile, relativePath, state);
  visit(sourceFile, []);

  /**
   * @param {ts.Node} node
   * @param {ts.Node[]} ancestors
   */
  function visit(node, ancestors) {
    if (isEffectRuntimeCall(node, "runSync", effectBindings)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      state.runSyncMatches.push(`${relativePath}:${line + 1}`);
    }
    if (isEffectRuntimeCall(node, "runPromise", effectBindings)) {
      const owner = enclosingOwnerName(ancestors, sourceFile);
      const boundarySite = siteKey(relativePath, owner);
      state.runPromiseSiteCounts.set(
        boundarySite,
        (state.runPromiseSiteCounts.get(boundarySite) ?? 0) + 1,
      );
    }
    collectForbiddenEffectAliases(node, sourceFile, relativePath, effectBindings, state);
    if (isTemplateNode(node)) {
      collectGeneratedTemplateBoundaries(node, ancestors, sourceFile, relativePath, state);
    }
    ts.forEachChild(node, child => visit(child, [...ancestors, node]));
  }
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {string} relativePath
 * @param {BoundaryState} state
 */
function collectForbiddenRuntimeImports(sourceFile, relativePath, state) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isEffectModuleSpecifier(statement.moduleSpecifier.text)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName !== "runPromise" && importedName !== "runSync") continue;
      const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
      const importedAs = element.name.text === importedName ? importedName : `${importedName} as ${element.name.text}`;
      state.forbiddenRuntimeImportMatches.push(`${relativePath}:${line + 1} imports ${importedAs}`);
    }
  }
}

/**
 * @param {ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression} node
 * @param {ts.Node[]} ancestors
 * @param {ts.SourceFile} sourceFile
 * @param {string} relativePath
 * @param {BoundaryState} state
 */
function collectGeneratedTemplateBoundaries(node, ancestors, sourceFile, relativePath, state) {
  const generatedSource = templateSource(node);
  if (!generatedSource.includes("runPromise") && !generatedSource.includes("runSync")) {
    return;
  }
  const owner = enclosingOwnerName(ancestors, sourceFile);
  const generatedFile = ts.createSourceFile(
    `${relativePath}#${owner}.generated.ts`,
    generatedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const effectBindings = collectEffectBindings(generatedFile);
  visitGenerated(generatedFile, []);

  /**
   * @param {ts.Node} generatedNode
   * @param {ts.Node[]} generatedAncestors
   */
  function visitGenerated(generatedNode, generatedAncestors) {
    if (isEffectRuntimeCall(generatedNode, "runSync", effectBindings)) {
      const { line } = generatedFile.getLineAndCharacterOfPosition(
        generatedNode.getStart(generatedFile),
      );
      state.runSyncMatches.push(`${relativePath}:${owner}<generated>:${line + 1}`);
    }
    if (isEffectRuntimeCall(generatedNode, "runPromise", effectBindings)) {
      const generatedOwner = enclosingOwnerName(generatedAncestors, generatedFile);
      const boundarySite = siteKey(relativePath, `${owner} <generated:${generatedOwner}>`);
      state.runPromiseSiteCounts.set(
        boundarySite,
        (state.runPromiseSiteCounts.get(boundarySite) ?? 0) + 1,
      );
    }
    collectForbiddenEffectAliases(
      generatedNode,
      generatedFile,
      `${relativePath}:${owner}<generated>`,
      effectBindings,
      state,
    );
    ts.forEachChild(
      generatedNode,
      child => visitGenerated(child, [...generatedAncestors, generatedNode]),
    );
  }
}

/**
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 * @param {string} relativePath
 * @param {EffectBindings} effectBindings
 * @param {BoundaryState} state
 */
function collectForbiddenEffectAliases(node, sourceFile, relativePath, effectBindings, state) {
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return;
  const initializer = node.initializer;
  const namespaceAlias = ts.isIdentifier(initializer) && effectBindings.namespaces.has(initializer.text)
    ? initializer.text
    : undefined;
  const runtimeAlias = ts.isPropertyAccessExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    effectBindings.namespaces.has(initializer.expression.text) &&
    (initializer.name.text === "runPromise" || initializer.name.text === "runSync")
    ? `${initializer.expression.text}.${initializer.name.text}`
    : undefined;
  if (namespaceAlias === undefined && runtimeAlias === undefined) return;
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  if (ts.isIdentifier(node.name)) {
    state.forbiddenAliasMatches.push(
      `${relativePath}:${line + 1} aliases ${namespaceAlias ?? runtimeAlias} as ${node.name.text}`,
    );
    return;
  }
  if (namespaceAlias === undefined) return;
  if (ts.isObjectBindingPattern(node.name)) {
    const names = node.name.elements
      .map(element => element.name.getText(sourceFile))
      .join(", ");
    state.forbiddenAliasMatches.push(`${relativePath}:${line + 1} destructures ${namespaceAlias} as ${names}`);
  }
}

/**
 * @param {ts.Node} node
 * @param {"runPromise" | "runSync"} methodName
 * @param {EffectBindings} effectBindings
 */
function isEffectRuntimeCall(node, methodName, effectBindings) {
  if (!ts.isCallExpression(node)) return false;
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === methodName &&
    ts.isIdentifier(node.expression.expression) &&
    effectBindings.namespaces.has(node.expression.expression.text)
  ) {
    return true;
  }
  return ts.isIdentifier(node.expression) && effectBindings[methodName].has(node.expression.text);
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {EffectBindings}
 */
function collectEffectBindings(sourceFile) {
  /** @type {EffectBindings} */
  const bindings = {
    namespaces: new Set(),
    runPromise: new Set(),
    runSync: new Set(),
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isEffectModuleSpecifier(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      bindings.namespaces.add(clause.name.text);
    }
    const namedBindings = clause?.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.namespaces.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "Effect") bindings.namespaces.add(element.name.text);
      if (importedName === "runPromise") bindings.runPromise.add(element.name.text);
      if (importedName === "runSync") bindings.runSync.add(element.name.text);
    }
  }
  return bindings;
}

/**
 * @param {string} value
 */
function isEffectModuleSpecifier(value) {
  return value === "effect" || value === "effect/Effect";
}

/**
 * @param {ts.Node} node
 * @returns {node is ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression}
 */
function isTemplateNode(node) {
  return ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

/**
 * @param {ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression} node
 */
function templateSource(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return `${node.head.text}${node.templateSpans
    .map(span => `undefined${span.literal.text}`)
    .join("")}`;
}

/**
 * @param {ts.Node[]} ancestors
 * @param {ts.SourceFile} sourceFile
 */
function enclosingOwnerName(ancestors, sourceFile) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      const className = enclosingClassName(ancestors.slice(0, index), sourceFile);
      const ownerName = nodeName(node.name, sourceFile);
      return className === undefined ? ownerName : `${className}.${ownerName}`;
    }
    if (ts.isConstructorDeclaration(node)) {
      const className = enclosingClassName(ancestors.slice(0, index), sourceFile);
      return className === undefined ? "constructor" : `${className}.constructor`;
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      return node.name.text;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const ownerName = ownerNameFromFunctionParent(node, sourceFile);
      if (ownerName !== undefined) return ownerName;
    }
  }
  return "<module>";
}

/**
 * @param {ts.FunctionExpression | ts.ArrowFunction} node
 * @param {ts.SourceFile} sourceFile
 */
function ownerNameFromFunctionParent(node, sourceFile) {
  const parent = node.parent;
  if (parent === undefined) return undefined;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) {
    const propertyName = nodeName(parent.name, sourceFile);
    if (propertyName === "try" || propertyName === "catch") return undefined;
    return propertyName;
  }
  if (ts.isBinaryExpression(parent) && ts.isPropertyAccessExpression(parent.left)) {
    return parent.left.getText(sourceFile);
  }
  return undefined;
}

/**
 * @param {ts.Node[]} ancestors
 * @param {ts.SourceFile} sourceFile
 */
function enclosingClassName(ancestors, sourceFile) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (ts.isClassDeclaration(node)) {
      return node.name?.getText(sourceFile) ?? "<anonymous class>";
    }
  }
  return undefined;
}

/**
 * @param {ts.PropertyName | undefined} name
 * @param {ts.SourceFile} sourceFile
 */
function nodeName(name, sourceFile) {
  return name === undefined ? "<anonymous>" : name.getText(sourceFile);
}

/**
 * @param {string} directory
 * @returns {Generator<string>}
 */
function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".wrangler") {
      continue;
    }
    const file = path.join(directory, entry);
    const stats = lstatSync(file);
    if (stats.isDirectory()) {
      yield* walk(file);
    } else if (stats.isFile()) {
      yield file;
    }
  }
}

/**
 * @param {string} filePath
 */
function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

/**
 * @param {string} file
 */
function isSupportedProductionSourceFile(file) {
  return productionSourceExtensions.has(path.extname(file));
}

/**
 * @param {string} file
 */
function scriptKindForPath(file) {
  switch (path.extname(file)) {
    case ".js":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * @param {string} file
 * @param {string} owner
 */
function siteKey(file, owner) {
  return `${file} :: ${owner}`;
}

function isCliEntrypoint() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entrypoint);
}
