import ts from '@typescript/typescript6';
import { createHash } from 'node:crypto';

export const targets = new Set(['prepareLogicalRelationalRead', 'selectLogicalIndexValues',
  'compileAppOrderedIndexBoundsV1', 'prepareAppIndexSnapshotReadResult', 'prepareAppRowsSnapshotReadResult',
  'prepareFiniteAttemptStorageCaptureBasis', 'inspectFiniteParticipantStorageDemand',
  'useCapturedPrivateJsonData', 'implicitReadTransportRefusal', 'makeCheckedOutConnection',
  'consumeLogicalDocumentRootMetadataDependency', 'captureFiniteMetadataDependency']);
export function transformRead(source, path) {
  const id = path.replaceAll('\\', '/');
  if (!id.includes('/packages/') || !id.includes('/src/') || !id.endsWith('.ts')) return;
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true), edits = [], sites = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && targets.has(node.expression.text)) {
      const name = node.expression.text, site = id.slice(id.indexOf('/packages/') + 1) + ':' + (file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      // Original argument expressions retain their evaluation order and are
      // evaluated exactly once, before entering the synchronous function.
      edits.push({ at: node.getStart(file), end: node.arguments.pos, text: 'globalThis.__readCpu.call(' + JSON.stringify(name) + ',' + JSON.stringify(site) + ',' + name + ',[' });
      edits.push({ at: node.end - 1, end: node.end, text: '])' }); sites.push({ name, site });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!sites.length) return;
  for (const edit of edits.sort((a,b) => b.at-a.at)) source = source.slice(0,edit.at) + edit.text + source.slice(edit.end);
  return 'globalThis.__readCpu.sources.push(' + JSON.stringify({ file: id.slice(id.indexOf('/packages/')+1), sites,
    sha256: createHash('sha256').update(source).digest('hex') }) + ');\n' + source;
}
