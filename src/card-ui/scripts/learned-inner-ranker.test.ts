import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildInnerFeatures,type Side} from '../src/lib/card-centering/learned-inner-features.ts';
import {decodeEnsemble,scoreEnsemble,voteEnsemble} from '../src/lib/card-centering/learned-inner-mlp.ts';
import {selectLearnedInnerBorders} from '../src/lib/card-centering/learned-inner-ranker.ts';
import {estimateInnerBorders} from '../src/lib/card-centering/inner-border.ts';
import {ENABLE_TOP_INNER_RESCUE} from '../src/lib/card-centering/top-inner-rescue.ts';
import {getCenteringStats} from '../src/lib/card-centering/centering.ts';
const bytes=readFileSync(new URL('../static/models/learned-inner-v1.bin',import.meta.url));
const models=decodeEnsemble(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const data=new Uint8ClampedArray(156*208*4);
for(let y=0;y<208;y++)for(let x=0;x<156;x++){for(let c=0;c<3;c++)data[(y*156+x)*4+c]=((x*31+y*17+c*53)^((Math.floor(x/9)+Math.floor(y/7))*19))%256;data[(y*156+x)*4+3]=255}
const image={width:156,height:208,data},defaults={top:5,bottom:5,left:5,right:5};
const golden=JSON.parse(readFileSync(new URL('./fixtures/learned-inner-golden.json',import.meta.url),'utf8'));
test('all 29 features and BF16 scores match frozen Python fixtures on every side',()=>{
 for(const r of golden){const candidates=buildInnerFeatures(image,r.diagnostic);assert.deepEqual(candidates.map(c=>c.features),r.features.map((row:number[])=>row.map(Math.fround)));const scores=scoreEnsemble(models,candidates.map(c=>c.features));assert.deepEqual(scores,r.scores);assert.deepEqual(voteEnsemble(scores),voteEnsemble(r.scores))}
});
test('candidate and vote ties choose first stored candidate',()=>{
 assert.equal(voteEnsemble(Array.from({length:10},()=>[1,1])).winner,0);
 assert.equal(voteEnsemble(Array.from({length:10},(_,i)=>i<5?[2,1]:[1,2])).winner,0);
});
test('malformed weights rejected',()=>assert.throws(()=>decodeEnsemble(new ArrayBuffer(4))));
for(const [name,extra] of Object.entries({
 'asset failure':{load:async()=>{throw Error('offline')}},
 'invalid features':{features:()=>[{position:1,depth:3,strength:1,support:1,features:Array(29).fill(NaN)}]},
 'invalid output':{score:()=>Array.from({length:10},()=>[Infinity])},
 'wrong output shape':{score:()=>[[1]]},
 'empty candidates':{features:()=>[]},
 'unexpected extraction error':{features:()=>{throw Error('oops')}},
 'rollback avoids model loading':{enabled:false,load:async()=>{throw Error('must not load')}}
}))test(name,async()=>assert.deepEqual(await selectLearnedInnerBorders(image,defaults,undefined,{enabled:true,load:async()=>models,...extra}),estimateInnerBorders(image,defaults)));
test('a failed side does not suppress other learned sides',async()=>{
 let seen:any[]=[];await selectLearnedInnerBorders(image,defaults,undefined,{enabled:true,load:async()=>models,features:(im,d)=>{if(d.side==='top')throw Error('top');return buildInnerFeatures(im,d)},debug:d=>seen=d});
 assert.equal(seen[0].fallback,true);assert.ok(seen.slice(1).every(d=>!d.fallback));
});
test('TOP rescue stays disabled and centering retains opposing-edge ratios',()=>{
 assert.equal(ENABLE_TOP_INNER_RESCUE,false);const c=getCenteringStats({top:3,bottom:5,left:4,right:6});assert.equal(c.topPct,37.5);assert.equal(c.leftPct,40);
});
