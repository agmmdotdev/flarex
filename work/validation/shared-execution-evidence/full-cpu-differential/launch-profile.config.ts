import { defineConfig } from 'vitest/config';
import base from './operation-profile.config.ts';
import { transformLaunch } from './launch-transform.mjs';
export default defineConfig({...base,plugins:[...base.plugins??[],{
  name:'checked-command-launch-partition',enforce:'pre',transform:(source,id)=>transformLaunch(source.replaceAll('\r\n','\n'),id),
}],test:{...base.test,setupFiles:[...base.test?.setupFiles??[],
  'work/validation/shared-execution-evidence/full-cpu-differential/launch-probe.ts']}});
