/** Canonical browser port of the frozen 29-feature numeric ranker extractor. */
export type Side='top'|'bottom'|'left'|'right';
export type Pixels={width:number;height:number;data:Uint8ClampedArray};
export type Candidate={position:number;depth:number;strength:number;support:number;features:number[]};
export const FEATURE_NAMES=['depth','strength','support','winner_strength','candidate_winner_ratio','rival_strength','rival_candidate_ratio','A_rank','search_start','search_end','side_top','side_bottom','side_left','side_right',...['3','5','7'].flatMap(n=>['fraction','variance','min_support','median_strength','run'].map(k=>`r${n}_${k}`))];
const sides:Side[]=['top','bottom','left','right'];
const median=(a:number[])=>{const x=[...a].sort((a,b)=>a-b),n=x.length;return n%2?x[n>>1]:(x[n/2-1]+x[n/2])/2};
// Python round uses ties-to-even; sample coordinates in A use Math.round instead.
const evenRound=(n:number)=>{const f=Math.floor(n);return n-f===.5?(f%2?f+1:f):Math.round(n)};
export function buildInnerFeatures(image:Pixels,d:{side:Side;searchStart?:number;searchEnd?:number;strength?:number}):Candidate[]{
 if(d.searchStart===undefined||d.searchEnd===undefined)return [];
 const vertical=d.side==='left'||d.side==='right',depth=vertical?image.width:image.height,along=vertical?image.height:image.width,reverse=d.side==='bottom'||d.side==='right';
 const positions:number[]=[],changes:number[][]=[],valid:boolean[][]=[],raw:{strength:number;support:number}[]=[];
 const value=(normal:number,tangent:number,c:number)=>{const q=reverse?depth-1-normal:normal,x=vertical?q:tangent,y=vertical?tangent:q;return image.data[(y*image.width+x)*4+c]};
 for(let p=d.searchStart;p<=d.searchEnd;p++){
  if(p<2||p>depth-3)throw Error('Invalid candidate scan');
  const row:number[]=[],ok:boolean[]=[];
  for(let j=0;j<80;j++){const t=Math.round(along*(.15+.7*j/79));let sum=0;for(let c=0;c<3;c++){const delta=(value(p+1,t,c)+value(p+2,t,c)-value(p-1,t,c)-value(p-2,t,c))/2;sum+=delta*delta}row.push(Math.sqrt(sum/3));ok.push(value(p-2,t,3)>=250&&value(p+2,t,3)>=250)}
  const sorted=row.filter((_,i)=>ok[i]).sort((a,b)=>a-b);positions.push(p);changes.push(row);valid.push(ok);raw.push({strength:sorted.length>=64?sorted[Math.floor(sorted.length*.35)]:0,support:row.filter((v,i)=>v>=12&&ok[i]).length/80});
 }
 const peaks=positions.map((_,i)=>i).filter(i=>raw[i].strength>=(raw[i-1]?.strength??-1)&&raw[i].strength>=(raw[i+1]?.strength??-1));
 const ranked=[...peaks].sort((a,b)=>raw[b].strength-raw[a].strength||positions[a]-positions[b]);
 const regional=new Map<number,{strength:number[][];support:number[][]}>();
 for(const n of [3,5,7]){const strength:number[][]=[],support:number[][]=[];let start=0;for(let j=0;j<n;j++){const size=Math.floor(80/n)+(j<80%n?1:0),ss:number[]=[],uu:number[]=[];for(let i=0;i<positions.length;i++){const vals=changes[i].slice(start,start+size).filter((_,k)=>valid[i][start+k]).sort((a,b)=>a-b);ss.push(vals.length>=Math.ceil(size*.8)?vals[Math.floor(vals.length*.35)]:0);uu.push(changes[i].slice(start,start+size).filter((v,k)=>v>=12&&valid[i][start+k]).length/size)}strength.push(ss);support.push(uu);start+=size}regional.set(n,{strength,support})}
 const radius=Math.max(1,evenRound(depth*.0025));
 return peaks.map(i=>{const p=positions[i],r=raw[i],rival=Math.max(0,...raw.filter((_,j)=>Math.abs(positions[j]-p)>Math.max(3,depth*.008)).map(x=>x.strength));
  const features=[p/depth*10,r.strength/100,r.support,(d.strength??0)/100,r.strength/Math.max(d.strength??0,1e-6),rival/100,Math.min(5,rival/Math.max(r.strength,1)),(ranked.indexOf(i)+1)/ranked.length,d.searchStart!/depth,d.searchEnd!/depth,...sides.map(s=>Number(s===d.side))];
  for(const n of [3,5,7]){const {strength,support}=regional.get(n)!;const depths:number[]=[],supports:number[]=[],strengths:number[]=[];let run=0,longest=0;
   for(let j=0;j<n;j++){let best=-1;for(let k=0;k<positions.length;k++)if(Math.abs(positions[k]-p)<=radius&&strength[j][k]>=(strength[j][k-1]??-1)&&strength[j][k]>=(strength[j][k+1]??-1)&&(best<0||strength[j][k]>strength[j][best]))best=k;
    const good=best>=0&&strength[j][best]>=14&&support[j][best]>=.7;if(good)depths.push(positions[best]/depth*100);run=good?run+1:0;longest=Math.max(longest,run);supports.push(support[j][i]);strengths.push(strength[j][i]);
   }
   const mean=depths.reduce((a,b)=>a+b,0)/depths.length,variance=depths.length?depths.reduce((a,b)=>a+(b-mean)**2,0)/depths.length:1;
   features.push(depths.length/n,Math.min(1,variance),Math.min(...supports),median(strengths)/100,longest/n);
  }
  // The training tensor is float32 before saved mean/std normalization.
  return {position:p,depth:p/depth*100,...r,features:features.map(Math.fround)};
 });
}
