import { defineConfig } from 'vitest/config';
import base from './launch-profile.config.ts';
const replace=(source:string,before:string,after:string)=>{
  if(source.split(before).length!==2)throw Error('Continuation probe source changed: '+before);
  return source.replace(before,after);
};
export default defineConfig({...base,plugins:[...base.plugins??[],{
  name:'continuation-observer-composition',enforce:'pre',transform(source,id){
    if(!id.replaceAll('\\','/').endsWith('/launch-probe.ts'))return;
    source=replace(source,"import { createLaunchObserver } from './launch-observer';",
      "import { createLaunchObserverWithContinuations as createLaunchObserver } from './continuation-runtime';");
    source=replace(source,"patch(prototypeOf(Drizzle.NodePgSession),'prepareQuery','prepare-replay',true);",'// Preparation replay is omitted in continuation campaigns.');
    source=replace(source,"const fileNames=['launch-probe.ts'","const fileNames=['continuation-observer.ts','continuation-runtime.ts','continuation-profile.config.ts','continuation-native/gc-cycles.cc','continuation-native/gc-cycles.node','launch-probe.ts'");
    return replace(source,"method:'Existing telescoping partition", "mode:process.env.FLAREX_CONTINUATION_MODE??'detailed',method:'Continuation partition excluding measured probe and GC cycles. Existing telescoping partition");
  },
} ]});
