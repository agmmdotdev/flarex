import ts from '@typescript/typescript6';
import { createHash } from 'node:crypto';

const effectCalls = new Set(['selectedUniqueValuesFor', 'selectedIndexValuesFor',
  'prepareUniqueStorageSelection', 'historicalUniqueSelection', 'readFiniteIndexRows',
  'readFiniteIndexPage', 'readFiniteBase', 'decodeCapturedAppIndexSnapshotPageEffect',
  'consumeCapturedAppRowsAtSnapshotEffect', 'hydrateSnapshotBase', 'acquireConnection',
  'runBoundedPromiseEffect', 'runDrainEffect', 'releaseConnectionEffect']);
const syncCalls = new Set(['lowerUnique', 'lowerIndex', 'implicitReadTransportRefusal',
  'makeCheckedOutConnection', 'executeNativePhysicalCommand']);
export function transformCandidate(source, path) {
  const id = path.replaceAll('\\', '/');
  if (!id.endsWith('/logicalDocuments/workingSet.ts') && !id.endsWith('/physicalSession/postgres.ts')) return;
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true), edits = [], sites = [];
  function visit(node) {
    const name = ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : undefined;
    const constructor = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Client' &&
      node.getText(file) === 'new Client(connection.cancellationClientConfig)';
    const mode = constructor ? 'constructor' : effectCalls.has(name) ? 'effect' : syncCalls.has(name) ? 'sync' : undefined;
    if (mode !== undefined) {
      const label = constructor ? 'cancellationClient' : name;
      edits.push({at:node.getStart(file), text: mode === 'constructor' ? 'globalThis.__candidateCpu.construct(() => (' :
        `globalThis.__operationCpu.${mode}(${JSON.stringify('Candidate.'+label)},${mode==='sync'?'() => (':''}`});
      edits.push({at:node.end, text:mode==='effect'?')':'))'});
      sites.push({name:label, mode, line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1});
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const edit of edits.sort((a,b)=>b.at-a.at)) source=source.slice(0,edit.at)+edit.text+source.slice(edit.at);
  return 'globalThis.__candidateCpu.sources.push('+JSON.stringify({file:id.slice(id.indexOf('/packages/')+1),sites,
    sha256:createHash('sha256').update(source).digest('hex')})+');\n'+source;
}
