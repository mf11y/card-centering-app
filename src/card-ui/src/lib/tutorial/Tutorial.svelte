<script lang="ts">
    import { tick } from 'svelte';
    import { tutorialSteps, tutorialEntry, tutorialGate, type TutorialState } from './tutorial';
    let { active = $bindable(false), context }: { active?: boolean; context: TutorialState } = $props();
    let step = $state(0);
    let notice = $state('');
    let collapsed = $state(false);
    $effect(() => { step; collapsed = false; });
    let panel = $state<HTMLElement>();
    let box = $state({ x: 0, y: 0, width: 0, height: 0 });
    let placement = $state({ x: 12, y: 12 });
    let found = $state(false);
    let wasActive = false;
    let hadImage = false;
    const current = $derived(tutorialSteps[step]);

    $effect(() => {
        if (active && !wasActive) { step = tutorialEntry(context); notice = ''; }
        wasActive = active;
        if (!active) { hadImage = context.hasImage; return; }
        const justLoaded = context.hasImage && !hadImage;
        hadImage = context.hasImage;
        if (!context.hasImage && step !== 0) { step = 0; notice = ''; }
        else if (justLoaded && step === 0) { step = 1; notice = ''; }
        else if (context.hasImage && !context.ready && step > 1) step = 1;
    });

    function exit() {
        active = false;
        document.querySelector<HTMLButtonElement>('.tutorial-tab')?.focus({ preventScroll: true });
    }
    function next() {
        notice = tutorialGate(step, context) ?? '';
        if (!notice) step = Math.min(step + 1, tutorialSteps.length - 1);
    }
    function visibleTarget() {
        return [...document.querySelectorAll<HTMLElement>(current.target)].find(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        });
    }
    $effect(() => {
        if (!active) return;
        current.target; // Re-anchor when the active step changes.
        let disposed = false;
        let target: HTMLElement | undefined;
        const sourceControls = step === 2 || step === 3 || step === 4;
        const warpSteps = step === 5 || step === 6;
        const readCentering = () => (step === 7 || step === 8) && window.innerWidth < 1280;
        const stackedControls = () => (sourceControls || warpSteps) && window.innerWidth < 1280;
        function position() {
            if (disposed || !panel) return;
            target = visibleTarget();
            found = Boolean(target);
            if (!target) return;
            const r = target.getBoundingClientRect();
            box = { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 };
            const pw = panel.offsetWidth, ph = panel.offsetHeight;
            const vw = window.innerWidth, vh = window.innerHeight;
            let x = r.right + 16, y = Math.max(12, r.top);
            if (stackedControls()) { x = (vw - pw) / 2; y = 12; }
            else if (readCentering() || vw < 768) { x = (vw - pw) / 2; y = vh - ph - 12; }
            else if (x + pw > vw - 12) {
                if (r.left - pw - 16 >= 12) x = r.left - pw - 16;
                else { x = Math.max(12, Math.min(r.left, vw - pw - 12)); y = r.bottom + 12; }
            }
            if (!stackedControls() && y + ph > vh - 12) y = Math.max(12, vh - ph - 12);
            placement = { x, y };
        }
        void tick().then(() => {
            if (disposed) return;
            target = visibleTarget();
            if (stackedControls() && target) {
                // Align the relevant controls or results with the viewport bottom.
                // Keep the tip at the top, away from the controls.
                const miniMap = warpSteps
                    ? target.closest('section')?.querySelector<HTMLElement>('[aria-label="Card controls mini map"]')
                    : target.closest('[aria-label="Card controls mini map"]');
                const controls = target.closest('[data-mobile-controls]') ?? miniMap?.parentElement ?? target;
                window.scrollBy(0, controls.getBoundingClientRect().bottom - window.innerHeight + 12);
            } else {
                target?.scrollIntoView({ block: 'center', behavior: 'instant' });
                if ((readCentering() || window.innerWidth < 768) && target) {
                    window.scrollBy(0, target.getBoundingClientRect().top - 20);
                }
            }
            position();
            panel?.focus({ preventScroll: true });
        });
        const resize = new ResizeObserver(position);
        if (panel) resize.observe(panel);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        const timer = window.setInterval(position, 250);
        return () => {
            disposed = true;
            resize.disconnect(); clearInterval(timer);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    });
</script>

<svelte:window onkeydown={(event) => { if (active && event.key === 'Escape') { event.preventDefault(); exit(); } }} />

{#if active}
    {#if found}
        <div class="tour-spotlight" aria-hidden="true" style={`left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`}></div>
    {/if}
    <section bind:this={panel} class="tour-callout" aria-label="Tutorial Mode" tabindex="-1"
        style={`left:${placement.x}px;top:${placement.y}px`}>
        <div class="tour-heading"><span>Step {step + 1} of {tutorialSteps.length}</span><button type="button" onclick={exit}>Exit Tutorial</button></div>
        <button class="tour-collapse" type="button" aria-expanded={!collapsed} onclick={() => collapsed = !collapsed}>{collapsed ? 'Show tip' : 'Hide tip'}</button>
        <div hidden={collapsed} aria-live="polite" aria-atomic="true">
            <h2>{current.title}</h2>
            <p>{#if 'mobileText' in current}
                <span class="tour-desktop-copy">{current.text}</span>
                <span class="tour-mobile-copy">{current.mobileText}</span>
            {:else}{current.text}{/if}{#if step === 4}
                <span class="tour-desktop-zoom"> You can also nudge with WASD or keyboard arrow keys.</span>
            {/if}{#if step === 5}
                <span class="tour-desktop-zoom"> Use the mouse scroll wheel over either preview to zoom.</span>
                <span class="tour-mobile-zoom"> Spread two fingers apart to zoom in; pinch them together to zoom out on either preview.</span>
            {/if}</p>
            {#if step === 1 && !context.ready}
                <p class="tour-notice">{tutorialGate(step, context)}</p>
            {:else if notice}
                <p class="tour-notice">{notice}</p>
            {/if}
        </div>
        <div class="tour-actions">
            <button type="button" disabled={step === 0} onclick={() => { step--; notice = ''; }}>Back</button>
            {#if step === tutorialSteps.length - 1}
                <button type="button" onclick={() => { step = tutorialEntry(context); notice = ''; }}>Restart Tutorial</button>
                <button class="tour-next" type="button" onclick={exit}>Finish Tutorial</button>
            {:else}
                <button class="tour-next" type="button" onclick={next}>Next</button>
            {/if}
        </div>
    </section>
{/if}

<style>
    .tour-mobile-copy,.tour-mobile-zoom { display:none; }
    @media(max-width:1279px) { .tour-desktop-copy { display:none; } .tour-mobile-copy { display:inline; } }
    @media(pointer:coarse) { .tour-desktop-zoom { display:none; } .tour-mobile-zoom { display:inline; } }
    .tour-spotlight { position:fixed; z-index:60; pointer-events:none; border:2px solid #22d3ee; border-radius:10px; box-shadow:0 0 0 9999px rgb(0 0 0 / 32%), 0 0 14px rgb(34 211 238 / 35%); }
    .tour-callout { position:fixed; z-index:70; width:min(320px, calc(100vw - 24px)); box-sizing:border-box; padding:16px; border:1px solid #22d3ee; border-radius:12px; background:var(--color-zinc-900); color:var(--color-zinc-100); box-shadow:0 8px 32px #0008; font-size:13px; line-height:1.5; max-height:calc(100dvh - 24px); overflow:auto; }
    .tour-heading,.tour-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .tour-heading { font-size:11px; color:var(--color-zinc-400); }
    h2 { font-size:16px; font-weight:600; margin:10px 0 6px; }
    p { margin:0; }
    .tour-notice { margin-top:10px; color:#67e8f9; }
    .tour-actions { margin-top:14px; flex-wrap:wrap; }
    button { border:1px solid var(--color-zinc-600); border-radius:6px; padding:5px 9px; cursor:pointer; }
    button:disabled { opacity:.4; cursor:default; }
    button:focus-visible { outline:2px solid #67e8f9; outline-offset:3px; }
    .tour-next { background:#155e75; color:#ecfeff; border-color:#22d3ee; }
    .tour-collapse { margin-top:6px; font-size:11px; padding:2px 6px; }
    .tour-heading button { border:0; padding:4px 0; color:var(--color-zinc-100); }
</style>
