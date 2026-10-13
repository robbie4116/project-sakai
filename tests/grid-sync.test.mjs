import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../supabase-sync.js',import.meta.url),'utf8');
function adapter(rows=[]) {
  const calls=[];
  const tables=[];
  const client={from:table=>{tables.push(table);return {select:async()=>({data:rows,error:null}),upsert:async(values)=>{calls.push(values);return {error:null};}}}};
  const window={TANIMAN_RF_LABELS:require('../rf-labels.js'),TANIMAN_GRID:require('../grid.js')};
  vm.runInNewContext(source,{window,navigator:{onLine:true},supabase:{createClient:()=>client},console});
  return {window,calls,tables};
}
test('legacy cloud rows cannot hydrate corrected pixel indices',async()=>{
  const {window}=adapter([{plot_idx:0,seasons:[{cropId:'carrot',cells:[0]}],updated_at:'2026-10-13'},{plot_idx:1000000,seasons:[],updated_at:'2026-10-13'}]);
  const state={plots:{}}; const merged=[];
  await window.syncInit(state,idx=>merged.push(idx));
  assert.deepEqual(merged,[0]);
  assert.equal(state.plots[0].seasons.length,0);
  assert.equal(state.plots[1000000],undefined);
});
test('new labels cannot overwrite legacy cloud rows',async()=>{
  const {window,calls,tables}=adapter();
  const state={plots:{0:{seasons:[{cropId:'carrot',cells:[0]}]}}};
  await window.syncPlots([0],state,'test-device');
  assert.equal(calls[0][0].plot_idx,1000000);
  assert.ok(state.plots[0]._synced_at);
  assert.deepEqual(tables,['s2_label_plots']);
});
