import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../app.js',import.meta.url),'utf8');
function extract(name) {
  const start=source.indexOf(`function ${name}(`), open=source.indexOf('{',start);
  let depth=0;
  for(let i=open;i<source.length;i++) { if(source[i]==='{')depth++;if(source[i]==='}' && --depth===0)return source.slice(start,i+1); }
  throw new Error(name);
}
function harness(referenceYear) {
  const context={state:{referenceYear,viewMonths:4095}, RFLabels:require('../rf-labels.js'),seasonHex:season=>season.classId===1?'carrot':'cabbage',queueSeasonChange:()=>{},isValidMmdd:require('../season-utils.js').isValidMmdd,seasonsOverlap:()=>true,monthRangeForViewMonth:()=>({start:'01-01',end:'12-31'}),toast:()=>{}};
  vm.createContext(context);
  vm.runInContext(['seasonIntersectsViewMonths','cellVisibleColors','eraseCellsFromSeasons'].map(extract).join('\n'),context);
  return context;
}
const observations = () => ({seasons:[
  {classId:1,cropId:null,referenceYear:2024,start:'01-01',end:'12-31',cells:[0]},
  {classId:2,cropId:null,referenceYear:2025,start:'01-01',end:'12-31',cells:[0]},
]});
test('selected crop-cycle year filters visible classes',()=>{
  const context=harness(2025);
  assert.deepEqual(Array.from(context.cellVisibleColors(observations(),0)),['cabbage']);
});
test('erasing a selected year preserves historical labels',()=>{
  const context=harness(2025), plot=observations();
  assert.equal(context.eraseCellsFromSeasons(0,plot,[0]),true);
  assert.deepEqual(plot.seasons.map(s=>s.referenceYear),[2024]);
  assert.deepEqual(plot.seasons[0].cells,[0]);
});
test('erase without a valid crop-cycle year changes no labels',()=>{
  const context=harness(''),plot=observations();
  assert.equal(context.eraseCellsFromSeasons(0,plot,[0]),false);
  assert.equal(plot.seasons.length,2);
});

test('schedule summary identifies dated and undated historical observations',()=>{
  const root={innerHTML:''};
  const context={document:{getElementById:()=>root},state:{plotIdx:0,lang:'en'},
    ensurePlot:()=>({seasons:[...observations().seasons,{classId:1,start:'01-01',end:'12-31',cells:[1]}]}),
    isValidMmdd:require('../season-utils.js').isValidMmdd,rangeWrapsYear:()=>false,
    RFLabels:require('../rf-labels.js'),Classes:{className:()=> 'Carrot'},
    seasonHex:()=> '#fff',escapeHtml:x=>x,tr:x=>x};
  vm.createContext(context);
  vm.runInContext(extract('renderScheduleSummary'),context);
  context.renderScheduleSummary();
  assert.match(root.innerHTML,/2024/);
  assert.match(root.innerHTML,/2025/);
  assert.match(root.innerHTML,/Undated/);
});
