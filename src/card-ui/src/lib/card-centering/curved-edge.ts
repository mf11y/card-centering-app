export type Point = { x:number; y:number };
export type BowQuad = [Point, Point, Point, Point]; // TL, TR, BR, BL
export const sides = ['top', 'right', 'bottom', 'left'] as const;
export type Side = typeof sides[number];
export type EdgeBow = Record<Side, number>;
export const emptyBow = ():EdgeBow => ({top:0, right:0, bottom:0, left:0});
// Actual midpoint displacement divided by chord length, not control-point displacement.
export const MAX_BOW = 0.04;
export const clampBow = (n:number) => Number.isFinite(n) ? Math.max(-MAX_BOW, Math.min(MAX_BOW,n)) : 0;
const cross = (a:Point,b:Point,c:Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function curve(a:Point,b:Point,bow:number) {
    const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
    const normal={x:-dy/(length||1),y:dx/(length||1)};
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const d=clampBow(bow)*length;
    const handle={x:mid.x+normal.x*d,y:mid.y+normal.y*d};
    const control={x:mid.x+2*normal.x*d,y:mid.y+2*normal.y*d};
    const samples=Array.from({length:33},(_,i)=>{const t=i/32,u=1-t;return {x:u*u*a.x+2*u*t*control.x+t*t*b.x,y:u*u*a.y+2*u*t*control.y+t*t*b.y};});
    return {a,b,normal,mid,length,handle,control,samples};
}
export function lineIntersection(a:Point,b:Point,c:Point,d:Point):Point|null {
    const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y;
    const den=ux*vy-uy*vx;
    if(Math.abs(den)<1e-9) return null;
    const t=((c.x-a.x)*vy-(c.y-a.y)*vx)/den;
    return {x:a.x+t*ux,y:a.y+t*uy};
}
export function deriveCurvedEdges(quad:BowQuad,bows:EdgeBow,enabled=true) {
    const requested=Object.fromEntries(sides.map(k=>[k,enabled?clampBow(bows[k]):0])) as EdgeBow;
    const turns=quad.map((a,i)=>cross(a,quad[(i+1)%4],quad[(i+2)%4]));
    let reason='';
    if(!quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)) || !turns.every(n=>n>1e-6) && !turns.every(n=>n< -1e-6)) reason='Invalid source quadrilateral; using existing straight geometry.';
    let curves=sides.map((key,i)=>({key,...curve(quad[i],quad[(i+1)%4],requested[key])}));
    const points=curves.flatMap(c=>c.samples.slice(0,-1));
    // Reject crossings among non-neighbor sampled segments. Endpoints are shared only by neighbors.
    for(let i=0; !reason && i<points.length; i++) for(let j=i+2;j<points.length;j++) {
        if(i===0&&j===points.length-1) continue;
        const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
        if(cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) {reason='Curves crossed; using straight edges.';break;}
    }
    const intersections=quad.map((p,i)=>lineIntersection(quad[(i+3)%4],p,p,quad[(i+1)%4]));
    if(intersections.some(p=>!p) && !reason) reason='Degenerate virtual sides; using existing straight geometry.';
    if(reason) curves=sides.map((key,i)=>({key,...curve(quad[i],quad[(i+1)%4],0)}));
    // Strategy A: adjacent chords share the original endpoint. Return it exactly to
    // avoid round-off changes in the existing homography, even at nonzero bow.
    return {virtualCorners:quad, virtualLines:quad.map((a,i)=>({a,b:quad[(i+1)%4]})), intersections, curves,
        fallback:Boolean(reason), reason, clamped:enabled&&sides.some(k=>requested[k]!==bows[k])};
}
