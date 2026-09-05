import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveCurvedEdges,emptyBow,MAX_BOW,type BowQuad} from '../src/lib/card-centering/curved-edge.ts';
const q:BowQuad=[{x:100,y:100},{x:400,y:110},{x:390,y:530},{x:90,y:520}];
test('zero bow and disabled assist preserve exact quad identity',()=>{
 assert.equal(deriveCurvedEdges(q,emptyBow()).virtualCorners,q);
 const off=deriveCurvedEdges(q,{top:.02,right:.02,bottom:.03,left:.01},false);
 assert.equal(off.virtualCorners,q);assert.ok(off.curves.every(c=>c.handle.x===c.mid.x&&c.handle.y===c.mid.y));
});
test('bowed bottom and multiple sides preserve convex ordered intersections',()=>{
 for(const bows of [{...emptyBow(),bottom:-.03},{top:.02,right:-.02,bottom:.03,left:.01}]) {
 const g=deriveCurvedEdges(q,bows); assert.equal(g.fallback,false);assert.equal(g.virtualCorners,q);
 g.intersections.forEach((p,i)=>{assert.ok(p);assert.ok(Math.hypot(p.x-q[i].x,p.y-q[i].y)<1e-8);});
 }
});
test('bottom movement is isolated; endpoints follow moved corners',()=>{
 const a=deriveCurvedEdges(q,emptyBow()), b=deriveCurvedEdges(q,{...emptyBow(),bottom:.03});
 for(const i of [0,1,3])assert.deepEqual(a.curves[i],b.curves[i]);
 assert.notDeepEqual(a.curves[2].handle,b.curves[2].handle);
 const moved:BowQuad=[q[0],q[1],{x:380,y:540},q[3]];
 const c=deriveCurvedEdges(moved,{...emptyBow(),bottom:.03});assert.equal(c.curves[1].b,moved[2]);assert.equal(c.curves[2].a,moved[2]);
});
test('extreme and nonfinite bow clamped, inverted quad falls back',()=>{
 const g=deriveCurvedEdges(q,{top:100,right:NaN,bottom:-100,left:Infinity});
 assert.equal(g.clamped,true);assert.equal(g.fallback,false);
 assert.ok(Math.abs(Math.hypot(g.curves[0].handle.x-g.curves[0].mid.x,g.curves[0].handle.y-g.curves[0].mid.y)/g.curves[0].length-MAX_BOW)<1e-8);
 assert.equal(deriveCurvedEdges([q[0],q[2],q[1],q[3]],emptyBow()).fallback,true);
});
