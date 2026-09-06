import {buildInnerFeatures,type Pixels,type Side} from './learned-inner-features.ts';
import {decodeEnsemble,scoreEnsemble,voteEnsemble} from './learned-inner-mlp.ts';
import {estimateInnerBorders,type InnerDiagnostic} from './inner-border.ts';
import {ENABLE_LEARNED_INNER_RANKER} from './inner-ranker-config.ts';
type Insets=Record<Side,number>;
type Models=ReturnType<typeof decodeEnsemble>;
export const LEARNED_INNER_ASSET='/models/learned-inner-v1.bin';
let modelPromise:Promise<Models>|undefined;
export function loadLearnedInnerModels(){
 return modelPromise??=(async()=>{const response=await fetch(LEARNED_INNER_ASSET);if(!response.ok)throw Error('Model asset unavailable');return decodeEnsemble(await response.arrayBuffer())})();
}
export type LearnedDiagnostic={side:Side;original:number;selected:number;candidateInsets:number[];votes:number[];winningVoteFraction:number;runnerUpVoteFraction:number;disagreement:number;entropy:number;differsFromA:boolean;fallback:boolean;reason:string};
type Options={enabled?:boolean;load?:()=>Promise<Models>;features?:typeof buildInnerFeatures;score?:typeof scoreEnsemble;debug?:(d:LearnedDiagnostic[])=>void};
/** A always runs unmodified first. Learned failures are isolated to the affected side. */
export async function selectLearnedInnerBorders(image:Pixels,defaults:Insets,diagnostics?:InnerDiagnostic[],options:Options={}):Promise<Insets>{
 const aDiagnostics:InnerDiagnostic[]=[],original=estimateInnerBorders(image,defaults,aDiagnostics);diagnostics?.push(...aDiagnostics);
 if(!(options.enabled??ENABLE_LEARNED_INNER_RANKER))return original;
 const result={...original},debug:LearnedDiagnostic[]=[];let models:Models|undefined;let loadFailed=false;
 try{models=await(options.load??loadLearnedInnerModels)()}catch{loadFailed=true}
 for(const d of aDiagnostics){const item:LearnedDiagnostic={side:d.side,original:original[d.side],selected:original[d.side],candidateInsets:[],votes:[],winningVoteFraction:0,runnerUpVoteFraction:0,disagreement:0,entropy:0,differsFromA:false,fallback:false,reason:''};debug.push(item);
  try{
   if(loadFailed||!models)throw Error('model_load_failed');
   const candidates=(options.features??buildInnerFeatures)(image,d);item.candidateInsets=candidates.map(p=>p.depth);
   if(!candidates.length)throw Error('empty_candidates');
   const scores=(options.score??scoreEnsemble)(models,candidates.map(p=>p.features));const vote=voteEnsemble(scores);
   if(scores[0].length!==candidates.length)throw Error('invalid_output_shape');
   const selected=candidates[vote.winner]?.depth;if(!Number.isFinite(selected)||selected<0||selected>=50)throw Error('invalid_selected_inset');
   result[d.side]=selected;Object.assign(item,{selected,votes:vote.counts,winningVoteFraction:vote.winningFraction,runnerUpVoteFraction:vote.runnerUpFraction,disagreement:vote.disagreement,entropy:vote.entropy,differsFromA:Math.round(selected*100)/100 !== original[d.side]});
  }catch(error){item.fallback=true;item.reason=error instanceof Error?error.message:'unexpected_ranker_error'}
 }
 // Debug hooks must not interfere with card processing.
 try{options.debug?.(debug);if(import.meta.env.DEV)(globalThis as typeof globalThis & {__learnedInnerDiagnostics?:LearnedDiagnostic[]}).__learnedInnerDiagnostics=debug}catch{}
 return result;
}
