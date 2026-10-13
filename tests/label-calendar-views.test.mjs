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
function harness() {
  const context={state:{viewMonths:4095}, RFLabels:require('../rf-labels.js'),seasonHex:season=>season.classId===1?'carrot':'cabbage',queueSeasonChange:()=>{},isValidMmdd:require('../season-utils.js').isValidMmdd,seasonsOverlap:()=>true,monthRangeForViewMonth:()=>({start:'01-01',end:'12-31'}),toast:()=>{}};
  vm.createContext(context);
  vm.runInContext(['seasonIntersectsViewMonths','cellVisibleColors','eraseCellsFromSeasons'].map(extract).join('\n'),context);
  return context;
}
const labels = () => ({seasons:[
  {classId:1,cropId:null,start:'01-01',end:'04-30',cells:[0,1]},
  {classId:2,cropId:null,start:'06-01',end:'09-30',cells:[0]},
]});
test('every recurring label on a cell is visible, with no year filter',()=>{
  const context=harness();
  assert.deepEqual(Array.from(context.cellVisibleColors(labels(),0)),['carrot','cabbage']);
});
test('erasing removes every label on the erased cells and keeps the rest',()=>{
  const context=harness(), plot=labels();
  assert.equal(context.eraseCellsFromSeasons(0,plot,[0]),true);
  assert.equal(plot.seasons.length,1);
  assert.deepEqual(plot.seasons[0].cells,[1]);
});
test('erasing an empty cell changes nothing',()=>{
  const context=harness(),plot=labels();
  assert.equal(context.eraseCellsFromSeasons(0,plot,[5]),false);
  assert.equal(plot.seasons.length,2);
});

test('schedule summary lists calendars without years',()=>{
  const root={innerHTML:''};
  const context={document:{getElementById:()=>root},state:{plotIdx:0,lang:'en'},
    ensurePlot:()=>labels(),
    isValidMmdd:require('../season-utils.js').isValidMmdd,rangeWrapsYear:()=>false,
    RFLabels:require('../rf-labels.js'),Classes:{className:()=> 'Carrot'},
    seasonHex:()=> '#fff',escapeHtml:x=>x,tr:x=>x};
  vm.createContext(context);
  vm.runInContext(extract('renderScheduleSummary'),context);
  context.renderScheduleSummary();
  assert.match(root.innerHTML,/Carrot · 01-01-04-30/);
  assert.doesNotMatch(root.innerHTML,/Undated|20\d\d/);
});
