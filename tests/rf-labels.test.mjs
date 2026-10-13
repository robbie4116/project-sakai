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

test('painting requires an explicit crop-cycle year and dates', () => {
  const crop = {id:'carrot',isResolved:true};
  const selection = {paintStartDate:'11-01',paintEndDate:'02-28',referenceYear:2024,fieldId:' F1 '};
  assert.deepEqual(labels.paintSeasonData(selection,crop), {cropId:'carrot',start:'11-01',end:'02-28',referenceYear:2024,fieldId:'F1'});
  assert.equal(labels.paintSeasonData({...selection,referenceYear:''},crop),null);
  assert.equal(labels.paintSeasonData({...selection,paintStartDate:''},crop),null);
});

test('different crops conflict only when absolute crop-cycle dates overlap', () => {
  const a = {cropId:'carrot',start:'11-01',end:'02-28',referenceYear:2024,cells:[0]};
  assert.equal(labels.hasConflict([a],{cropId:'cabbage',start:'01-01',end:'03-01',referenceYear:2025},[0]),true);
  assert.equal(labels.hasConflict([a],{cropId:'cabbage',start:'01-01',end:'03-01',referenceYear:2024},[0]),false);
  assert.equal(labels.hasConflict([a],{...a,cropId:'carrot'},[0]),false);
});

test('class-based target crops with null crop names still conflict',()=>{
  const a={classId:1,cropId:null,start:'01-01',end:'03-01',referenceYear:2024,cells:[0]};
  assert.equal(labels.hasConflict([a],{...a,classId:2},[0]),true);
  assert.equal(labels.hasConflict([a],{...a,classId:1},[0]),false);
});

test('undated legacy annotations do not block a dated observation',()=>{
  const legacy={classId:1,cropId:null,start:'01-01',end:'03-01',cells:[0]};
  assert.equal(labels.hasConflict([legacy],{...legacy,classId:2,referenceYear:2024},[0]),false);
  assert.equal(labels.hasConflict([{...legacy,referenceYear:2024}],{...legacy,classId:2,referenceYear:2024},[0]),true);
});

test('remote storage uses a separate index range and rejects invalid plot indices', () => {
  assert.equal(labels.cloudPlotIdx(0),1000000);
  assert.equal(labels.cloudPlotIdx(119),1000119);
  assert.equal(labels.localPlotIdx(0),null);
  assert.equal(labels.localPlotIdx(1000013),13);
  assert.equal(labels.localPlotIdx(1000120),null);
  assert.throws(()=>labels.cloudPlotIdx(-1));
});
