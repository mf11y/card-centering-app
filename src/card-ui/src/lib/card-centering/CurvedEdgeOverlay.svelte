<script lang="ts">
    import { createCurvedMapping } from './curved-mapping';
    import { deriveCurvedEdges, clampBow, type BowQuad, type EdgeBow, type Side } from './curved-edge';
    let { quad, bows=$bindable(), width, height, zoom=1, activeSide=null, onselect }: {activeSide?:Side|null; onselect:(side:Side)=>void; quad:BowQuad; bows:EdgeBow; width:number; height:number; zoom?:number}=$props();
    let plane = $state<HTMLDivElement>();
    let dragging:Side|null=null;
    let dragStart={x:0,y:0,bow:0};
    let showGrid=$state(false);
    const mapping=$derived.by(()=>{if(!import.meta.env.DEV)return null;try{return createCurvedMapping(quad,bows,width,height);}catch{return null;}});
    const geometry=$derived(deriveCurvedEdges(quad,bows));
    $effect(()=>{if(import.meta.env.DEV && plane) Object.assign(plane,{curvedEdgeDiagnostics:{originalCorners:quad,bows,...geometry,mappingGrid:mapping?.grid,jacobianSafe:mapping?.safe}});});
    function move(e:PointerEvent,key:Side) {
        if(dragging!==key) return;
        e.preventDefault(); e.stopPropagation();
        if(!plane) return;
        const r=plane.getBoundingClientRect(), c=geometry.curves.find(c=>c.key===key)!;
        const dx=(e.clientX-dragStart.x)*width/r.width,dy=(e.clientY-dragStart.y)*height/r.height;
        bows={...bows,[key]:clampBow(dragStart.bow+(dx*c.normal.x+dy*c.normal.y)/(c.length||1))};
    }
    function keydown(e:KeyboardEvent,key:Side) {
        if(e.key==='Enter'||e.key===' ') {e.preventDefault();e.stopPropagation();onselect(key);return;}
        if(e.key==='Home') {e.preventDefault();e.stopPropagation();bows={...bows,[key]:0};}
        // Direction keys bubble to the shared hold controller, just like corner nudges.
    }

</script>
<svelte:window onkeydown={(e)=>{if(import.meta.env.DEV && e.altKey && e.key.toLowerCase()==='g'){e.preventDefault();showGrid=!showGrid;}}} />
<div class="plane" bind:this={plane}>
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {#if showGrid && mapping}
            {#each mapping.grid as row}<polyline points={row.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#a78bfa" stroke-width="1" vector-effect="non-scaling-stroke" />{/each}
            {#each mapping.grid[0] as _,i}<polyline points={mapping.grid.map(row=>`${row[i].x},${row[i].y}`).join(' ')} fill="none" stroke="#a78bfa" stroke-width="1" vector-effect="non-scaling-stroke" />{/each}
        {/if}
        {#each geometry.curves as c}
            <path d={`M ${c.a.x} ${c.a.y} Q ${c.control.x} ${c.control.y} ${c.b.x} ${c.b.y}`} fill="none" stroke="#22d3ee" stroke-width={Math.max(1.5, 3 - zoom) / zoom} vector-effect="non-scaling-stroke" />
        {/each}
    </svg>
    {#each geometry.curves as c}
        <button type="button" class="bow-handle" class:selected={activeSide===c.key} aria-pressed={activeSide===c.key} onfocus={()=>onselect(c.key)} aria-label={`Adjust ${c.key} edge bow`} title={`${c.key} bow: drag inward/outward. Arrow keys adjust; Home clears.`}
            style:left={`${100*c.handle.x/width}%`} style:top={`${100*c.handle.y/height}%`} style:transform={`translate(-50%,-50%) scale(${1/zoom})`}
            onclick={(e)=>{e.stopPropagation();onselect(c.key);}}
            onpointerdown={(e)=>{e.preventDefault();e.stopPropagation();dragging=c.key;dragStart={x:e.clientX,y:e.clientY,bow:bows[c.key]};onselect(c.key);e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);}}
            onpointermove={(e)=>move(e,c.key)} onpointerup={()=>dragging=null} onpointercancel={()=>dragging=null} onlostpointercapture={()=>dragging=null}
            onkeydown={(e)=>keydown(e,c.key)}>
            <span class="bow-midpoint" aria-hidden="true"></span>
            <span class="bow-arrow-position" style:transform={`translate(-50%,-50%) translate(${c.normal.x*20}px,${c.normal.y*20}px) rotate(${Math.atan2(c.normal.y,c.normal.x)*180/Math.PI-90}deg)`}>
                <svg class:arrow-breathe={activeSide===c.key} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 21V5M6 11l6-6 6 6" />
                </svg>
            </span>
        </button>
    {/each}
    {#if geometry.fallback}<span class="fallback" role="status">Curve fit unavailable; straight edges retained.</span>{/if}
</div>
<style>
.plane {position:absolute;inset:0;pointer-events:none;}
.bow-handle {position:absolute;width:44px;height:44px;display:grid;place-items:center;pointer-events:auto;touch-action:none;cursor:pointer;z-index:11;background:transparent;border:0;padding:0;outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent;}
.bow-midpoint {width:5px;height:5px;border-radius:50%;background:#22d3ee;pointer-events:none;}
.bow-handle.selected .bow-midpoint {background:#f87171;}
.bow-arrow-position {position:absolute;left:50%;top:50%;width:28px;height:28px;color:#22d3ee;}
.bow-arrow-position svg {width:100%;height:100%;}
.bow-handle:hover:not(.selected) .bow-arrow-position {color:#86efac;}
.bow-handle.selected .bow-arrow-position {color:#f87171;}
.bow-handle:focus,.bow-handle:focus-visible {outline:none;box-shadow:none;}
.fallback {position:absolute;top:0;left:0;background:#18181b;color:#22d3ee;font-size:12px;}
</style>
