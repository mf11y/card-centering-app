import {computeHomography,invertHomography,applyHomography,type Quad,type Point} from './geometry';
import {deriveCurvedEdges,type EdgeBow} from './curved-edge';
export function createCurvedMapping(quad:Quad,bows:EdgeBow,width:number,height:number) {
 const inverse=invertHomography(computeHomography(quad,[{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}]));
 const geometry=deriveCurvedEdges(quad,bows);
 const base=(u:number,v:number)=>applyHomography(inverse,u*(width-1),v*(height-1));
 const displacement=(i:number,u:number,v:number):Point=>{
  const c=geometry.curves[i],p=base(u,v),dx=c.b.x-c.a.x,dy=c.b.y-c.a.y;
  const t=((p.x-c.a.x)*dx+(p.y-c.a.y)*dy)/(c.length*c.length);
  // The curve parameter follows projective position along the chord.
  return {x:4*t*(1-t)*(c.handle.x-c.mid.x),y:4*t*(1-t)*(c.handle.y-c.mid.y)};
 };
 const map=(u:number,v:number):Point=>{
  const p=base(u,v),t=displacement(0,u,0),b=displacement(2,u,1),l=displacement(3,0,v),r=displacement(1,1,v);
  // Transfinite interpolation of residuals; all four corner residuals are zero,
  // so the usual subtracted bilinear corner blend is identically zero.
  return {x:p.x+(1-v)*t.x+v*b.x+(1-u)*l.x+u*r.x,y:p.y+(1-v)*t.y+v*b.y+(1-u)*l.y+u*r.y};
 };
 let safe=!geometry.fallback,minRatio=Infinity;
 // Reject projective poles and changes of local orientation or near-collapse.
 const denominators=[ [0,0],[width,0],[width,height],[0,height] ].map(([x,y])=>inverse[2][0]*x+inverse[2][1]*y+inverse[2][2]);
 safe &&= denominators.every(d=>d>1e-8)||denominators.every(d=>d< -1e-8);
 for(let j=0;safe&&j<=32;j++)for(let i=0;i<=32;i++) {
  const u=i/32,v=j/32,e=1e-4,p=map(u,v),a=map(u+e,v),b=map(u,v+e),q=base(u,v),c=base(u+e,v),d=base(u,v+e);
  const det=(a.x-p.x)*(b.y-p.y)-(a.y-p.y)*(b.x-p.x);
  const ref=(c.x-q.x)*(d.y-q.y)-(c.y-q.y)*(d.x-q.x);
  const ratio=det/ref; minRatio=Math.min(minRatio,ratio);
  if(!Number.isFinite(ratio)||ratio<.15||ratio>6) {safe=false;break;}
 }
 return {map,base,inverse,geometry,safe,minRatio,
  grid:Array.from({length:11},(_,j)=>Array.from({length:11},(_,i)=>map(i/10,j/10)))};
}
