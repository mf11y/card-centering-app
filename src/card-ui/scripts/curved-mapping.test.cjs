const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {createCurvedMapping}=require('../src/lib/card-centering/curved-mapping.ts');
const {emptyBow,sides}=require('../src/lib/card-centering/curved-edge.ts');
const {computeHomography,invertHomography,applyHomography}=require('../src/lib/card-centering/geometry.ts');
const q=[{x:80,y:40},{x:400,y:85},{x:370,y:560},{x:120,y:500}],w=350,h=489;
const H=invertHomography(computeHomography(q,[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}]));
const zero=createCurvedMapping(q,emptyBow(),w,h);
for(let j=0;j<20;j++)for(let i=0;i<20;i++) {
 const u=i/19,v=j/19,a=zero.map(u,v),b=applyHomography(H,u*(w-1),v*(h-1));
 assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-10);
}
for(const bows of [...sides.map(k=>({...emptyBow(),[k]:-.035})),{top:.02,right:-.025,bottom:-.035,left:.02}]) {
 const m=createCurvedMapping(q,bows,w,h);assert.ok(m.safe);assert.ok(m.minRatio>.15);
 const corners=[[0,0],[1,0],[1,1],[0,1]];
 corners.forEach(([u,v],i)=>{const p=m.map(u,v);assert.ok(Math.hypot(p.x-q[i].x,p.y-q[i].y)<1e-8);});
 for(let i=0;i<4;i++)for(let j=0;j<=100;j++) {
  const z=j/100,[u,v]=i===0?[z,0]:i===1?[1,z]:i===2?[z,1]:[0,z];
  const p=m.map(u,v),b=m.base(u,v),c=m.geometry.curves[i],dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
  const t=((b.x-c.a.x)*dx+(b.y-c.a.y)*dy)/(c.length*c.length),a=1-t;
  const expected={x:a*a*c.a.x+2*a*t*c.control.x+t*t*c.b.x,y:a*a*c.a.y+2*a*t*c.control.y+t*t*c.b.y};
  assert.ok(Math.hypot(p.x-expected.x,p.y-expected.y)<1e-8);
 }
 // Smoothness across former edge/interior regions; no piecewise seams.
 for(let i=1;i<99;i++){const u=i/100,a=m.map(u-1e-5,.5),b=m.map(u+1e-5,.5);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.02);}
}
console.log('PASS projective zero identity, all four curved boundaries, multiple bows, fixed corners, continuity, positive Jacobians');
