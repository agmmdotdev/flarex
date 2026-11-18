import ts from '@typescript/typescript6';
import { createHash } from 'node:crypto';
const selected = {
  '/values/privateJsonData.ts': ['capture', 'detachIssuedJson'],
  '/logicalDocuments/relationalRows.ts': ['captureLogicalRelationalCanonicalRow', 'captureLogicalRelationalActivityJson',
    'inspectLogicalRelationalCanonicalRow', 'nativeLogicalRelationalCanonicalRow', 'validateLogicalRelationalCanonicalRow',
    'detachLogicalCanonicalDocument', 'detachLogicalCanonicalRevision', 'detachLogicalRelationalActivityJson', 'canonicalBytesMatch',
    'lowerLogicalCanonicalUniqueKey', 'lowerLogicalCanonicalIndexKey'],
  '/logicalDocuments/detachChanges.ts': ['detachLogicalDocumentRootChanges'],
  '/documents/appRowCanonicalEvidence.ts': ['detachStoredAppDocumentEvidence', 'inspectStoredAppDocumentEvidence'],
  '/indexes/appDeveloperIndexCommitV1.ts': ['lowerAppDeveloperIndexKeyV1'],
  '/unique/appUniqueConstraintCommitV1.ts': ['lowerCanonicalAppUniqueConstraintV1Result'],
  '/unique/appUniqueKeyContract.ts': ['canonicalizeAppUniqueKeyV1Result'],
  '/flarex-protocol/src/value.ts': ['normalizeFlarexValueV1', 'normalizeFlarexValueJsonV1', 'retainCanonicalFlarexValueOwnershipV1',
    'inspectCanonicalFlarexValueOwnershipV1', 'canonicalizeNormalizedValue', 'verifyFlarexValueEvidenceV1',
    'decodeCanonicalFlarexValueEvidenceV1', 'evidenceBytes'],
  '/flarex-protocol/src/value-runtime-core.ts': ['normalizeFlarexRuntimeValueWithLimitsV1', 'canonicalFlarexRuntimeValueToJsonV1',
    'createOwnedCanonicalFlarexRuntimeValueProjectionV1'],
  '/flarex-protocol/src/json.ts': ['encodeCanonicalJson', 'isJson'],
  '/flarex-protocol/src/ordered-index.ts': ['decodeOrderedIndexComponentsV1', 'encodeOrderedIndexComponentsV1', 'encodeAppOrderedIndexKeyV1'],
  '/utils/src/bytes.ts': ['copyBytes', 'copyBytesToArrayBuffer', 'encodeBytesToLowercaseHex', 'compareBytesLexicographically', 'bytesEqual', 'bytesEqualFullScan'],
  '/execution/journal/codecs.ts': ['sha256', 'requireJson'],
};
const schemaMethods = new Set(['decodeUnknownResult','decodeResult','decodeSync','decodeUnknownSync','encodeResult','encodeUnknownResult','encodeSync','encodeUnknownSync']);
const hash = text => createHash('sha256').update(text).digest('hex');
export function transformRepresentation(source, path) {
  const id = path.replaceAll('\\','/');
  if (!id.includes('/packages/') || !id.includes('/src/') || !id.endsWith('.ts')) return;
  const names = Object.entries(selected).find(([suffix])=>id.endsWith(suffix))?.[1] ?? [];
  const clones = source.includes('structuredClone(');
  const encoderCalls = !id.endsWith('/flarex-protocol/src/json.ts') && source.includes('encodeCanonicalJson(');
  if (!names.length && !clones && !encoderCalls) return;
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true), edits=[], sites=[];
  const short = id.slice(id.indexOf('/packages/')+1);
  function wrapBody(fn, name) {
    if (!fn.body || fn.asteriskToken) throw Error('Selected representation owner has no synchronous/async body: '+name);
    const body=fn.body, site=short+':'+name;
    const args=fn.parameters.filter(p=>ts.isIdentifier(p.name)).map(p=>p.name.text);
    // These two module-private functions receive records just constructed by
    // this codec. No foreign boundary gets extra property reads.
    if(name==='canonicalizeNormalizedValue')args.push('normalized.value','normalized.valueJson');
    if(name==='retainCanonicalFlarexValueOwnershipV1')args.push('document.value','document.valueJson','document.canonicalBytes','document.sha256');
    sites.push(site);
    if(fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)){
      if(!ts.isBlock(body))throw Error('Async representation owner must have block');
      edits.push({at:body.getStart(file)+1,text:'globalThis.__representation.note('+JSON.stringify(site)+',['+args.join(',')+']);'});
      return;
    }
    const begin='const __representationToken=globalThis.__representation.begin('+JSON.stringify(site)+',['+args.join(',')+']);try{';
    const end='}catch(__representationCause){globalThis.__representation.thrown(__representationToken);throw __representationCause;}finally{globalThis.__representation.end(__representationToken);}';
    if(ts.isBlock(body)){
      edits.push({at:body.getStart(file)+1,text:begin},{at:body.end-1,text:end});
      function returns(node){
        if(node!==body && ts.isFunctionLike(node))return;
        if(ts.isReturnStatement(node) && node.expression){
          edits.push({at:node.expression.getStart(file),text:'globalThis.__representation.result(__representationToken,'},{at:node.expression.end,text:')'});
        }
        ts.forEachChild(node,returns);
      }
      returns(body);
    }else edits.push({at:body.getStart(file),text:'{'+begin+'return globalThis.__representation.result(__representationToken,'},
      {at:body.end,text:');'+end+'}'});
  }
  function visit(node){
    if(encoderCalls && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==='encodeCanonicalJson') {
      // A synchronous callsite label identifies who requested a full JSON walk.
      // Refuse arguments whose evaluation cannot move into a lexical arrow.
      function suspended(n) { return ts.isAwaitExpression(n)||ts.isYieldExpression(n)||ts.forEachChild(n,suspended); }
      if(node.arguments.some(suspended))throw Error('Suspending canonical JSON callsite: '+short);
      const site='caller:'+short+':'+(file.getLineAndCharacterOfPosition(node.getStart(file)).line+1);sites.push(site);
      edits.push({at:node.getStart(file),text:'globalThis.__representation.atCall('+JSON.stringify(site)+',()=>'}, {at:node.end,text:')'});
    }
    if(ts.isFunctionDeclaration(node) && node.body && names.includes(node.name?.text))wrapBody(node,node.name.text);
    if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer){
      const init=node.initializer;
      if(names.includes(node.name.text) && (ts.isArrowFunction(init)||ts.isFunctionExpression(init)))wrapBody(init,node.name.text);
      if(names.length && ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) &&
        init.expression.expression.getText(file)==='Schema' && schemaMethods.has(init.expression.name.text)){
        const site=short+':schema:'+node.name.text;sites.push(site);
        edits.push({at:init.getStart(file),text:'globalThis.__representation.wrap('+JSON.stringify(site)+','},{at:init.end,text:')'});
      }
    }
    if(clones && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==='structuredClone'){
      const site=short+':'+(file.getLineAndCharacterOfPosition(node.getStart(file)).line+1);sites.push('clone:'+site);
      edits.push({at:node.expression.getStart(file),remove:node.expression.end-node.expression.getStart(file),text:'globalThis.__representation.clone'},
        {at:node.expression.end+1,text:JSON.stringify(site)+','});
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
  if(!sites.length)return;
  const originalHash=hash(source);
  for(const edit of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,edit.at)+edit.text+source.slice(edit.at+(edit.remove??0));
  return 'globalThis.__representation.sources.push('+JSON.stringify({file:short,originalHash,transformedHash:hash(source),sites})+');\n'+source;
}
