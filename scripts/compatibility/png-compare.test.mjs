import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {comparePng,cropPng} from './png-compare.mjs';

test('PNG comparison detects one changed pixel beyond the browser canvas height limit',()=>{
  const png=new PNG({width:8,height:70000});png.data.fill(255);
  const original=PNG.sync.write(png);
  assert.equal(comparePng(original,original).changedPixels,0);
  png.data[(69999*8+7)*4]=0;
  const changed=PNG.sync.write(png),result=comparePng(original,changed);
  assert.equal(result.changedPixels,1);assert.equal(result.sameSize,true);
  assert.deepEqual(result.actualSize,[8,70000]);
  const bottom=PNG.sync.read(cropPng(png,69998,70000));
  assert.equal(bottom.data[(1*8+7)*4],0);
  assert.equal(bottom.height,2);
});

test('PNG dimensions and channel tolerance cannot conceal missing pixels',()=>{
  const a=new PNG({width:2,height:2});a.data.fill(255);
  const b=new PNG({width:2,height:1});b.data.fill(255);
  assert.equal(comparePng(PNG.sync.write(a),PNG.sync.write(b)).changedPixels,2);
  const before=PNG.sync.write(a);a.data[0]=239;
  assert.equal(comparePng(before,PNG.sync.write(a),16).changedPixels,0);
  a.data[0]=238;assert.equal(comparePng(before,PNG.sync.write(a),16).changedPixels,1);
});
