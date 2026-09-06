/** Fixed 10-member 29→64→32→1 MLP. Emulates the locked CUDA BF16 inference casts. */
const buffer=new ArrayBuffer(4),floats=new Float32Array(buffer),bits=new Uint32Array(buffer);
export function bf16(x:number){floats[0]=x;bits[0]=(bits[0]+0x7fff+((bits[0]>>>16)&1))&0xffff0000;return floats[0]}
type Model={mean:Float32Array;std:Float32Array;layers:{w:Float32Array;b:Float32Array;input:number;output:number}[]};
export function decodeEnsemble(bytes:ArrayBuffer):Model[]{
 if(bytes.byteLength!==163640)throw Error('Invalid model length');const data=new Float32Array(bytes);if(!data.every(Number.isFinite))throw Error('Nonfinite model');let cursor=0;
 const take=(n:number,round=false)=>{const a=data.slice(cursor,cursor+n);cursor+=n;return round?a.map(bf16):a};
 return Array.from({length:10},()=>{const mean=take(29),std=take(29);if(!std.every(x=>x>0))throw Error('Invalid normalization');const layers=[{input:29,output:64},{input:64,output:32},{input:32,output:1}].map(({input,output})=>({input,output,w:take(input*output,true),b:take(output,true)}));return {mean,std,layers}});
}
export function scoreEnsemble(models:Model[],features:number[][]):number[][]{
 if(models.length!==10||features.some(x=>x.length!==29||!x.every(Number.isFinite)))throw Error('Invalid numeric features');
 return models.map(m=>features.map(row=>{let x=row.map((v,i)=>bf16(Math.fround(Math.fround(Math.fround(v)-m.mean[i])/m.std[i])));
  for(let layer=0;layer<3;layer++){const l=m.layers[layer],next:number[]=[];for(let j=0;j<l.output;j++){let sum=0;for(let k=0;k<l.input;k++)sum+=x[k]*l.w[j*l.input+k];let y=bf16(Math.fround(sum+l.b[j]));if(layer<2)y=Math.max(0,y);next.push(y)}x=next}
  if(!Number.isFinite(x[0]))throw Error('Invalid model output');return x[0];
 }));
}
export function voteEnsemble(scores:number[][]){
 if(scores.length!==10||!scores[0]?.length||scores.some(r=>r.length!==scores[0].length||!r.every(Number.isFinite)))throw Error('Invalid model output');
 const counts=Array(scores[0].length).fill(0) as number[];for(const row of scores){let best=0;for(let j=1;j<row.length;j++)if(row[j]>row[best])best=j;counts[best]++}
 let winner=0;for(let j=1;j<counts.length;j++)if(counts[j]>counts[winner])winner=j;const ranked=[...counts].sort((a,b)=>b-a);const winningFraction=counts[winner]/10,runnerUpFraction=(ranked[1]??0)/10;
 return {winner,counts,winningFraction,runnerUpFraction,disagreement:1-winningFraction,entropy:-counts.reduce((a,n)=>n?a+n/10*Math.log2(n/10):a,0)};
}
