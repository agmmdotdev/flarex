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
 *   runPromiseWith: Set<string>;
 *   runPromiseExit: Set<string>;
 *   runPromiseExitWith: Set<string>;
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
 *   runPromiseWithSiteCounts: Map<string, number>;
 *   runPromiseExitSiteCounts: Map<string, number>;
 *   runPromiseExitWithSiteCounts: Map<string, number>;
 *   forbiddenAliasMatches: string[];
 *   forbiddenRuntimeImportMatches: string[];
 * }} BoundaryState
 *
 * @typedef {{
 *   errors: string[];
 *   runSyncMatches: string[];
 *   runPromiseSiteCounts: Map<string, number>;
 *   runPromiseWithSiteCounts: Map<string, number>;
 *   runPromiseExitSiteCounts: Map<string, number>;
 *   runPromiseExitWithSiteCounts: Map<string, number>;
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
  [siteKey("packages/executor/src/runtime/health.ts", "getExecutorHealth"), 1],
  // Public executor methods and native host/framework callbacks require Promises.
  [siteKey("packages/executor/src/sync/liveQueries.ts", "runLiveQueryPromise"), 1],
  [siteKey("packages/executor/src/sync/liveQueryDeliveries.ts", "runLiveQueryDeliveryPromise"), 1],
  [siteKey("packages/executor/src/maintenance/maintenance.ts", "runMaintenancePromise"), 1],
  [siteKey("packages/executor/src/sync/outbox.ts", "runOutboxPromise"), 1],
  [siteKey("packages/executor/src/invocation/sessions.ts", "runInvokeSessionPromise"), 1],
  [siteKey("packages/executor/src/mutation/authentication/transactionGrant.ts", "verify"), 1],
  [siteKey("packages/flarex-backend/src/artifactRuntime.ts", "ServiceBindingExecutionArtifactRuntime.invoke"), 1],
  [siteKey("packages/flarex-backend/src/artifactRuntime.ts", "fetch"), 1],
  [siteKey("packages/flarex-backend/src/artifactRuntime/ApplicationWorkerCore.ts", "runWorkerProtocolDecoder"), 1],
  [siteKey("packages/flarex-backend/src/taskComputeDelivery/WorkerLoaderTaskComputeProvider.ts", "TaskWorkerInputCapabilityTarget.read"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "requireProjectId"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "runConnectionRoute"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "runConnectionWebSocketMessage"), 1],
  [siteKey("packages/flarex-backend/src/connectionDO.ts", "resolveSyncAuthenticateIdentity"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "DeliveryDO.alarm"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "DeliveryDO.wakeEffect"), 1],
  [siteKey("packages/flarex-backend/src/deliveryDO.ts", "runDeliveryRoute"), 1],
  [siteKey("packages/flarex-backend/src/deployment/InternalRouteBoundary.ts", "runDeploymentDurableObjectRoute"), 1],
  [siteKey("packages/flarex-backend/src/deploymentSyncDO.ts", "DeploymentSyncDO.runCatchUpProbe"), 1],
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
  [siteKey("packages/medusa-adapter/src/currency-service.ts", "promise"), 1],
  [siteKey("packages/persistence-postgres/src/storage/catalog/appSchemaPublication.ts", "runPreparedAppSchemaPublicationTransactionEffect"), 1],
  [siteKey("packages/persistence-postgres/src/storage/catalog/appSchemaCandidateValidation.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/storage/catalog/appTableDefinitionsArtifacts.ts", "runPreparedAppTableDefinitionsArtifactTransactionEffect"), 1],
  [siteKey("packages/persistence-postgres/src/application/revision/applicationRevisionRegistrationV1.ts", "runRegistrationTransactionAttempt"), 1],
  [siteKey("packages/persistence-postgres/src/storage/indexes/indexBuildReconciliation.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/application/revision/applicationRevisionReadinessV1.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/application/revision/applicationRevisionActivationV1.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/database/locatedEffectTransaction.ts", "startLocatedEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/application/applicationPointQuerySnapshotV1.ts", "startReadTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1.ts", "startAppOrderedIndexBuildTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/installation/physicalDefinitionLifecycle.ts", "startLocatedTransaction"), 1],
  // Each named transaction callback owns admission and closes it before returning.
  [siteKey("packages/persistence-postgres/src/commit/commitFeed.ts", "captureCommitFeedRows"), 1],
  // Claim-for-commit, claim-batch and settle-claim are distinct transaction callbacks.
  [siteKey("packages/persistence-postgres/src/commit/commitWakeOutbox.ts", "claimForCommit"), 1],
  [siteKey("packages/persistence-postgres/src/commit/commitWakeOutbox.ts", "claimReadyBatch"), 1],
  [siteKey("packages/persistence-postgres/src/commit/commitWakeOutbox.ts", "settleClaim"), 1],
  [siteKey("packages/persistence-postgres/src/database/postgresLocatedReadCommitted.ts", "runLocatedReadCommittedWithPoolClient"), 1],
  [siteKey("packages/persistence-postgres/src/database/postgresLocatedReadCommitted.ts", "createPostgresClientLocatedReadCommittedTransactionRunnerV1"), 1],
  // Compatibility maintenance owns migration and canonical backfills together;
  // the final bridge initializes a genuinely fresh unverified installation.
  [siteKey("packages/persistence-postgres/src/database/pglite.ts", "migrate"), 2],
  [siteKey("packages/persistence-postgres/src/database/postgres.ts", "migrate"), 1],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorityBootstrap.ts", "captureBootstrapFrontier"), 1],
  // One bounded page-read transaction and a separate atomic provisioning transaction.
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorityBootstrap.ts", "runBootstrapBatch"), 2],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorityBootstrap.ts", "verifyBootstrapFrontier"), 1],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorityControlRead.ts", "read"), 1],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorityProvisioning.ts", "ensure"), 1],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorizationEpochAuthority.ts", "getCurrentClock"), 1],
  [siteKey("packages/persistence-postgres/src/database/runtimePersistence.ts", "ensureAppTableDefinitionsArtifactV1"), 1],
  [siteKey("packages/persistence-postgres/src/database/runtimePersistence.ts", "publishAppSchemaV1"), 1],
  [siteKey("packages/persistence-postgres/src/database/postgresRuntime.ts", "runPostgresTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/scope/scopeAuthorizationEpochAuthority.ts", "runScopeAuthorizationEpochEffectTransaction"), 1],
  // Promise-only Drizzle callbacks own transaction admission and its final cleanup.
  [siteKey("packages/persistence-postgres/src/scope/splitScopeAuthorityProvisioning.ts", "ensure"), 1],
  [siteKey("packages/persistence-postgres/src/scope/splitScopeAuthorityProvisioning.ts", "reserveNewControlAuthority"), 1],
  [siteKey("packages/persistence-postgres/src/scope/splitScopeAuthorityProvisioning.ts", "publishExactControlAuthority"), 1],
  [siteKey("packages/persistence-postgres/src/scope/splitScopeAuthorityProvisioning.ts", "readExactControlAuthorityState"), 1],
  [siteKey("packages/persistence-postgres/src/scope/splitScopeClockTarget.ts", "ensureInitialClock"), 1],
  [siteKey("packages/persistence-postgres/src/scope/splitScopeClockTarget.ts", "getCurrentClock"), 1],
  [siteKey("packages/persistence-postgres/src/storage/catalog/stableTableCatalog.ts", "runStableTableCatalogEffectTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/execution/transactionSessionActivation.ts", "[LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]"), 1],
  [siteKey("packages/persistence-postgres/src/execution/transactionSessionActivation.ts", "[RUN_LOCATED_REPEATABLE_READ_V1]"), 1],
  [siteKey("packages/persistence-postgres/src/execution/transactionSessionActivation.ts", "[TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]"), 1],
  [siteKey("packages/persistence-postgres/src/execution/transactionSessionActivation.ts", "createDefaultLocatedReadCommittedTransactionRunnerV1"), 1],
  [siteKey("packages/standard-application-invocation/src/ApplicationQuerySystem.ts", "ApplicationQueryRpcCapability.revalidate"), 1],
  [siteKey("packages/standard-application-invocation/src/ApplicationQuerySystem.ts", "ApplicationQueryRpcCapability.readPointDocument"), 1],
  [siteKey("packages/standard-application-invocation/src/ApplicationQuerySystem.ts", "ApplicationQueryRpcCapability.queryIndexRange"), 1],
  // RpcTarget requires a Promise; the capability retains its existing snapshot lifetime.
  [siteKey("packages/standard-application-invocation/src/ApplicationQuerySystem.ts", "ApplicationQueryRpcCapability.takeIncomingRelationSources"), 1],
]);

/** @type {Map<string, number>} */
const allowedRunPromiseExitSites = new Map([
  // Journal RPC owners retain full callback Cause across their Promise protocol.
  [siteKey("packages/executor/src/mutation/journal/applicationPointMutationJournalCapability.ts", "runJournalEffect"), 1],
  [siteKey("packages/executor/src/mutation/journal/pointMutationJournalRpc.ts", "PointMutationJournalRpcSessionStateV1.#run"), 1],
  // Native RpcTarget callbacks own deadline, cancellation and wire-result projection.
  [siteKey("packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskQueryCallback.ts", "ApplicationTaskQueryCallbackTarget.invoke"), 1],
  [siteKey("packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskMutationCallback.ts", "ApplicationTaskMutationCallbackTarget.invoke"), 1],
  // These located transaction owners retain full Cause until native settlement.
  [siteKey("packages/persistence-postgres/src/application/applicationActivation.ts", "runLocatedTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/application/applicationReadiness.ts", "runLocatedTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/application/tasks/applicationTaskSystemRunCreation.ts", "runEffectInTransaction"), 1],
  [siteKey("packages/persistence-postgres/src/commit/pointCommitPromiseBoundary.ts", "runPointCommitInTransactionEffect"), 1],
  // Dedicated installation maintenance owns draining and page settlement.
  [siteKey("packages/persistence-postgres/src/database/postgresInstallationMaintenance.ts", "verifyAndPublish"), 1],
  [siteKey("packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts", "backfillLogicalReadProjections"), 1],
]);

/** @type {Map<string, number>} */
const allowedRunPromiseExitWithSites = new Map([
  // Existing transaction bridges lend only the captured diagnostic policy,
  // tracer/parent and explicit tracing flags, never business services or Clock.
  [siteKey("packages/persistence-postgres/src/database/effectTransaction.ts", "runEffectTransactionSettlement"), 1],
  [siteKey("packages/persistence-postgres/src/database/locatedReadCommittedEffect.ts", "startLocatedRead"), 1],
  [siteKey("packages/persistence-postgres/src/commit/pointCommitPromiseBoundary.ts", "runPointCommitInTransactionEffect"), 1],
  // Physical settlement lends the captured context and bounded cancellation signal.
  [siteKey("packages/persistence-postgres/src/database/physicalSession/postgres.ts", "runCallbackEffect"), 1],
]);

/** @type {Map<string, number>} */
const allowedRunPromiseWithSites = new Map([
  // The native framework Promise owner preserves captured tracing and cancellation.
  [siteKey("packages/medusa-adapter/src/commerce-promise-owner.ts", "run"), 1],
  // These existing Payload DAL/rollback edges preserve actual invocation
  // diagnostics and cancellation instead of starting a default runtime.
  [siteKey("packages/payload-adapter/src/adapter.ts", "run"), 1],
  [siteKey("packages/payload-adapter/src/adapter.ts", "unsupported"), 1],
]);

/** @type {Array<"runPromise" | "runPromiseWith" | "runPromiseExit" | "runPromiseExitWith" | "runSync">} */
const runtimeMethods = ["runPromise", "runPromiseWith", "runPromiseExit", "runPromiseExitWith", "runSync"];

if (isCliEntrypoint()) {
  const productionSourceFiles = Array.from(walk(sourceRoot))
    .filter(isSupportedProductionSourceFile)
    .filter(file => normalizePath(file).includes("/src/"))
    // Preserve the existing test-only fixture exclusion after its folder move.
    .filter(file => !normalizePath(file).includes("/test/") &&
      normalizePath(file) !== normalizePath(path.join(sourceRoot,
        "persistence-postgres/src/testing/applicationRelationQuerySystemTestFixture.ts")));
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
    console.log(`Allowed production Effect.runPromiseWith sites: ${allowedRunPromiseWithSites.size}`);
    console.log(`Allowed production Effect.runPromiseExit sites: ${allowedRunPromiseExitSites.size}`);
    console.log(`Allowed production Effect.runPromiseExitWith sites: ${allowedRunPromiseExitWithSites.size}`);
  }
}

/**
 * @param {SourceInput[]} sources
 * @param {Map<string, number>} allowedSites
 * @param {Map<string, number>} allowedExitSites
 * @param {Map<string, number>} allowedExitWithSites
 * @param {Map<string, number>} allowedWithSites
 * @returns {BoundaryReport}
 */
export function analyzeEffectRuntimeBoundaries(sources, allowedSites = allowedRunPromiseSites,
  allowedExitSites = allowedRunPromiseExitSites, allowedExitWithSites = allowedRunPromiseExitWithSites,
  allowedWithSites = allowedRunPromiseWithSites) {
  /** @type {BoundaryState} */
  const state = {
    runSyncMatches: [],
    runPromiseSiteCounts: new Map(),
    runPromiseWithSiteCounts: new Map(),
    runPromiseExitSiteCounts: new Map(),
    runPromiseExitWithSiteCounts: new Map(),
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
        "Production source must not import Effect runtime APIs directly; use Effect directly at audited boundaries.",
        ...state.forbiddenRuntimeImportMatches.map(match => `  - ${match}`),
      ].join("\n"),
    );
  }

  checkSiteCounts("runPromise", state.runPromiseSiteCounts, allowedSites, errors);
  checkSiteCounts("runPromiseWith", state.runPromiseWithSiteCounts, allowedWithSites, errors);
  checkSiteCounts("runPromiseExit", state.runPromiseExitSiteCounts, allowedExitSites, errors);
  checkSiteCounts("runPromiseExitWith", state.runPromiseExitWithSiteCounts, allowedExitWithSites, errors);

  return {
    errors,
    runSyncMatches: state.runSyncMatches,
    runPromiseSiteCounts: state.runPromiseSiteCounts,
    runPromiseWithSiteCounts: state.runPromiseWithSiteCounts,
    runPromiseExitSiteCounts: state.runPromiseExitSiteCounts,
    runPromiseExitWithSiteCounts: state.runPromiseExitWithSiteCounts,
    forbiddenAliasMatches: state.forbiddenAliasMatches,
    forbiddenRuntimeImportMatches: state.forbiddenRuntimeImportMatches,
  };
}

/**
 * @param {string} method
 * @param {Map<string, number>} counts
 * @param {Map<string, number>} allowedSites
 * @param {string[]} errors
 */
function checkSiteCounts(method, counts, allowedSites, errors) {
  for (const [boundarySite, count] of counts) {
    const expected = allowedSites.get(boundarySite);
    if (expected === undefined) {
      errors.push(`Unexpected production Effect.${method} boundary at ${boundarySite} (${count}).`);
    } else if (expected !== count) {
      errors.push(
        `Production Effect.${method} boundary count changed at ${boundarySite}: expected ${expected}, found ${count}.`,
      );
    }
  }

  for (const [boundarySite, expected] of allowedSites) {
    if (!counts.has(boundarySite)) {
      errors.push(
        `Allowed production Effect.${method} boundary is missing at ${boundarySite}: expected ${expected}.`,
      );
    }
  }

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
    recordPromiseCalls(node, effectBindings, siteKey(relativePath, enclosingOwnerName(ancestors, sourceFile, effectBindings)), state);
    collectForbiddenEffectAliases(node, sourceFile, relativePath, effectBindings, state);
    if (isTemplateNode(node)) {
      collectGeneratedTemplateBoundaries(node, ancestors, sourceFile, relativePath, effectBindings, state);
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
      if (!runtimeMethods.some(method => method === importedName)) continue;
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
 * @param {EffectBindings} sourceBindings
 * @param {BoundaryState} state
 */
function collectGeneratedTemplateBoundaries(node, ancestors, sourceFile, relativePath, sourceBindings, state) {
  const generatedSource = templateSource(node);
  if (!generatedSource.includes("runPromise") && !generatedSource.includes("runSync")) {
    return;
  }
  const owner = enclosingOwnerName(ancestors, sourceFile, sourceBindings);
  const generatedFile = ts.createSourceFile(
    `${relativePath}#${owner}.generated.ts`,
    generatedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const effectBindings = collectEffectBindings(generatedFile);
  collectForbiddenRuntimeImports(generatedFile, `${relativePath}:${owner}<generated>`, state);
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
    const generatedOwner = enclosingOwnerName(generatedAncestors, generatedFile, effectBindings);
    recordPromiseCalls(generatedNode, effectBindings, siteKey(relativePath, `${owner} <generated:${generatedOwner}>`), state);
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
 * @param {EffectBindings} bindings
 * @param {string} site
 * @param {BoundaryState} state
 */
function recordPromiseCalls(node, bindings, site, state) {
  /** @type {Array<["runPromise" | "runPromiseWith" | "runPromiseExit" | "runPromiseExitWith", Map<string, number>]>} */
  const counters = [["runPromise", state.runPromiseSiteCounts], ["runPromiseWith", state.runPromiseWithSiteCounts], ["runPromiseExit", state.runPromiseExitSiteCounts],
    ["runPromiseExitWith", state.runPromiseExitWithSiteCounts]];
  for (const [method, counts] of counters) {
    if (isEffectRuntimeCall(node, method, bindings)) counts.set(site, (counts.get(site) ?? 0) + 1);
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
  const runtimeAlias = runtimeReferenceMethod(initializer, effectBindings) !== undefined ||
    isEffectRuntimeCall(initializer, "runPromiseExitWith", effectBindings) ||
    isEffectRuntimeCall(initializer, "runPromiseWith", effectBindings)
    ? initializer.getText(sourceFile) : undefined;
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
 * @param {"runPromise" | "runPromiseWith" | "runPromiseExit" | "runPromiseExitWith" | "runSync"} methodName
 * @param {EffectBindings} effectBindings
 */
function isEffectRuntimeCall(node, methodName, effectBindings) {
  if (!ts.isCallExpression(node)) return false;
  return runtimeReferenceMethod(node.expression, effectBindings) === methodName;
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
    runPromiseWith: new Set(),
    runPromiseExit: new Set(),
    runPromiseExitWith: new Set(),
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
      if (importedName === "runPromiseWith") bindings.runPromiseWith.add(element.name.text);
      if (importedName === "runPromiseExit") bindings.runPromiseExit.add(element.name.text);
      if (importedName === "runPromiseExitWith") bindings.runPromiseExitWith.add(element.name.text);
      if (importedName === "runSync") bindings.runSync.add(element.name.text);
    }
  }
  // Resolve local alias chains for call counting too; aliases remain forbidden.
  let changed = true;
  while (changed) {
    changed = false;
    visitAliases(sourceFile);
  }
  return bindings;

  /** @param {ts.Node} node */
  function visitAliases(node) {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const initializer = node.initializer;
      if (ts.isIdentifier(node.name)) {
        if (ts.isIdentifier(initializer) && bindings.namespaces.has(initializer.text)) {
          addBinding(bindings.namespaces, node.name.text);
        } else {
          const method = runtimeReferenceMethod(initializer, bindings);
          if (method !== undefined) addBinding(bindings[method], node.name.text);
        }
      } else if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(initializer) &&
        bindings.namespaces.has(initializer.text)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property = element.propertyName === undefined ? element.name.text :
            ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName) ? element.propertyName.text : undefined;
          const method = runtimeMethods.find(candidate => candidate === property);
          if (method !== undefined) addBinding(bindings[method], element.name.text);
        }
      }
    }
    ts.forEachChild(node, visitAliases);
  }

  /** @param {Set<string>} set @param {string} name */
  function addBinding(set, name) {
    if (set.has(name)) return;
    set.add(name);
    changed = true;
  }
}

/**
 * @param {ts.Node} node
 * @param {EffectBindings} bindings
 */
function runtimeReferenceMethod(node, bindings) {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
    bindings.namespaces.has(node.expression.text)) {
    const name = node.name.text;
    return runtimeMethods.find(method => method === name);
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
    bindings.namespaces.has(node.expression.text) && ts.isStringLiteral(node.argumentExpression)) {
    const name = node.argumentExpression.text;
    return runtimeMethods.find(method => method === name);
  }
  if (ts.isIdentifier(node)) return runtimeMethods.find(method => bindings[method].has(node.text));
  return undefined;
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
 * @param {EffectBindings} bindings
 */
function enclosingOwnerName(ancestors, sourceFile, bindings) {
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
      const ownerName = ownerNameFromFunctionParent(node, sourceFile, bindings);
      if (ownerName !== undefined) return ownerName;
    }
  }
  return "<module>";
}

/**
 * @param {ts.FunctionExpression | ts.ArrowFunction} node
 * @param {ts.SourceFile} sourceFile
 * @param {EffectBindings} bindings
 */
function ownerNameFromFunctionParent(node, sourceFile, bindings) {
  let parent = node.parent;
  // Effect.fn("trace name")(callback) constructs the named operation. An
  // ordinary start(async tx => ...) callback must retain its enclosing owner.
  if (parent !== undefined && ts.isCallExpression(parent) && isEffectFnConstructor(parent.expression, bindings)) {
    parent = parent.parent;
  }
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

/** @param {ts.Expression} expression @param {EffectBindings} bindings */
function isEffectFnConstructor(expression, bindings) {
  let target = expression;
  while (ts.isCallExpression(target)) target = target.expression;
  return ts.isPropertyAccessExpression(target) && target.name.text === "fn" &&
    ts.isIdentifier(target.expression) && bindings.namespaces.has(target.expression.text);
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
