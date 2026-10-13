import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const labels = require('../rf-labels.js');

test('classes match the seven-class paper scheme and resolve other crops', () => {
  assert.deepEqual(labels.CLASS_MAPPING, {carrot:1,cabbage:2,potato:3,other_cultivated:4,forest:5,built_up:6,bare_fallow:7});
  assert.equal(labels.classIdForCrop({id:'crop_uuid',isResolved:true}),4);
  assert.equal(labels.classIdForCrop({id:'unknown',isResolved:false}),null);
});

test('painting needs only a class and dates, never a year', () => {
  const crop = {id:'carrot',isResolved:true};
  const selection = {paintStartDate:'11-01',paintEndDate:'02-28',fieldId:' F1 '};
  assert.deepEqual(labels.paintSeasonData(selection,crop), {cropId:'carrot',start:'11-01',end:'02-28',fieldId:'F1'});
  assert.deepEqual(labels.paintSeasonData({...selection,fieldId:undefined},crop), {cropId:'carrot',start:'11-01',end:'02-28',fieldId:''});
  assert.equal(labels.paintSeasonData({...selection,paintStartDate:''},crop),null);
  assert.equal(labels.paintSeasonData(selection,{id:'unknown',isResolved:false}),null);
});

test('different crops conflict when their recurring calendars share any day', () => {
  const potato = {cropId:'potato',start:'05-01',end:'07-31',cells:[0]};
  assert.equal(labels.hasConflict([potato],{cropId:'cabbage',start:'08-01',end:'10-31'},[0]),false);
  assert.equal(labels.hasConflict([potato],{cropId:'cabbage',start:'07-01',end:'09-30'},[0]),true);
  assert.equal(labels.hasConflict([potato],{cropId:'cabbage',start:'07-31',end:'09-30'},[0]),true, 'shared end day');
  assert.equal(labels.hasConflict([potato],{cropId:'cabbage',start:'05-01',end:'07-31'},[0]),true, 'identical dates');
  assert.equal(labels.hasConflict([potato],{cropId:'cabbage',start:'05-01',end:'07-31'},[1]),false, 'different cell');
  assert.equal(labels.hasConflict([potato],{cropId:'potato',start:'06-01',end:'08-31'},[0]),false, 'same crop');
});

test('wrapping calendars conflict across New Year', () => {
  const carrot = {cropId:'carrot',start:'11-01',end:'02-28',cells:[0]};
  assert.equal(labels.hasConflict([carrot],{cropId:'cabbage',start:'02-01',end:'04-30'},[0]),true);
  assert.equal(labels.hasConflict([carrot],{cropId:'cabbage',start:'12-15',end:'12-20'},[0]),true);
  assert.equal(labels.hasConflict([carrot],{cropId:'cabbage',start:'03-01',end:'10-31'},[0]),false);
});

test('class-based target crops with null crop names still conflict',()=>{
  const a={classId:1,cropId:null,start:'01-01',end:'03-01',cells:[0]};
  assert.equal(labels.hasConflict([a],{...a,classId:2},[0]),true);
  assert.equal(labels.hasConflict([a],{...a,classId:1},[0]),false);
});

test('stored labels that still carry a legacy year are compared by calendar only',()=>{
  const legacy={classId:1,cropId:null,start:'01-01',end:'03-01',referenceYear:2023,cells:[0]};
  assert.equal(labels.hasConflict([legacy],{classId:2,cropId:null,start:'02-01',end:'02-10'},[0]),true);
});

test('remote storage uses a separate index range and rejects invalid plot indices', () => {
  assert.equal(labels.cloudPlotIdx(0),1000000);
  assert.equal(labels.cloudPlotIdx(119),1000119);
  assert.equal(labels.localPlotIdx(0),null);
  assert.equal(labels.localPlotIdx(1000013),13);
  assert.equal(labels.localPlotIdx(1000120),null);
  assert.throws(()=>labels.cloudPlotIdx(-1));
});
