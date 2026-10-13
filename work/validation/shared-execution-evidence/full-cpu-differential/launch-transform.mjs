import ts from '@typescript/typescript6';
import { createHash } from 'node:crypto';
export function transformLaunch(source,path){
  const id=path.replaceAll('\\','/');
  if(!id.endsWith('/physicalSession/postgres.ts')&&!id.endsWith('/physicalSession/drizzle.ts'))return;
  const file=ts.createSourceFile(id,source,ts.ScriptTarget.Latest,true),edits=[],sites=[];
  const wrap=(node,name,mode='fn')=>{
    edits.push({at:node.getStart(file),text:mode==='command'?'globalThis.__operationCpu.effect("Launch.command",globalThis.__launchCpu.command(':
      `globalThis.__launchCpu.${mode}(${JSON.stringify(name)},${mode==='run'?'()=>(':''}`});
    edits.push({at:node.end,text:mode==='command'||mode==='run'?'))':')'});
    sites.push({name,mode,line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1});
  };
  const isCall=(node,name)=>ts.isCallExpression(node)&&node.expression.getText(file)===name;
  function visit(node){
    if(isCall(node,'runBoundedPromiseEffect')&&node.getText(file).includes('executeNativePhysicalCommand('))wrap(node,'command','command');
    if(ts.isVariableDeclaration(node)&&['trackPromiseLike','trackedQuery'].includes(node.name.getText(file))&&node.initializer)
      wrap(node.initializer,node.name.getText(file)==='trackPromiseLike'?'Promise.register':'Promise.queryFence');
    if(ts.isArrowFunction(node)){
      const body=node.body.getText(file);
      if(body.includes('pending.delete(mirror)')&&!body.includes('const mirror'))wrap(node,'Promise.trackerSettle');
      if(node.parent&&isCall(node.parent,'Effect.callback')&&body.includes('const operationController = new AbortController()'))wrap(node,'Promise.bridgeStart');
      if(body.startsWith('finish(Effect.'))wrap(node,'Promise.resume');
      if(body.includes('operationController.abort()')&&!body.includes('const operationController'))wrap(node,'Promise.finalize');
    }
    if(id.endsWith('/physicalSession/drizzle.ts')&&isCall(node,'session.prepareQuery'))wrap(node,'Driver.prepare','run');
    if(id.endsWith('/physicalSession/drizzle.ts')&&ts.isPropertyAccessExpression(node)&&node.getText(file)==='command.mapResult')
      wrap(node,'Driver.mapResult');
    ts.forEachChild(node,visit);
  }
  visit(file);
  for(const edit of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,edit.at)+edit.text+source.slice(edit.at);
  return 'globalThis.__launchCpu.sources.push('+JSON.stringify({file:id.slice(id.indexOf('/packages/')+1),sites,
    sha256:createHash('sha256').update(source).digest('hex')})+');\n'+source;
}
