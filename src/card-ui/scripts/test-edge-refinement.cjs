// Run from card-ui: node scripts/test-edge-refinement.cjs
// Transpile the pure TS modules in memory; no browser or extra dependencies.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(name) {
  const file=path.resolve(__dirname,'../src/lib/card-centering',name+'.ts');
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module=new Module(file);module._compile(code,file);return module.exports;
}
const {refineCardEdges}=load('edge-refinement');
const {nativeMask}=load('native-mask');
const truth=[{x:125,y:75},{x:375,y:95},{x:360,y:420},{x:105,y:400}];
function image(occluded=false, blank=false) {
  const width=500,height=500,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const inside=truth.every((a,i)=>{const b=truth[(i+1)%4];return (b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)>=0;});
    const value=!blank&&inside&&!(occluded&&x>=205&&x<=245&&y>=380&&y<=445)?225:35;
    const offset=(y*width+x)*4;data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=255;
  }
  return {width,height,data};
}
const initial=truth.map((p,i)=>({x:p.x+[3,-2,-3,2][i],y:p.y+[2,3,-2,-3][i]}));
for(const occluded of [false,true]) {
  const result=refineCardEdges(image(occluded),initial);
  const mean=result.refined.reduce((s,p,i)=>s+Math.hypot(p.x-truth[i].x,p.y-truth[i].y),0)/4;
  assert.equal(result.accepted,true);assert.ok(mean<1.5,`mean corner error ${mean}`);
}
const blank=refineCardEdges(image(false,true),initial);
assert.equal(blank.accepted,false);assert.deepEqual(blank.refined,initial);
assert.throws(()=>refineCardEdges(image(),initial,-1));
for(const fixture of JSON.parse(fs.readFileSync(path.join(__dirname,'native-mask-fixtures.json'),'utf8'))) {
  const result=nativeMask(new Float32Array(fixture.logits),8,8,fixture.width,fixture.height,fixture.box);
  assert.deepEqual(Array.from(result),fixture.expected,'Native mask differs from Python reference');
}
console.log('PASS: perspective edges, occlusion, blank fallback, invalid parameters, four Python native-mask fixtures');
