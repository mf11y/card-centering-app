# Curved Edge Assist: inverse image dewarp

Off by default. SOURCE always displays the original photo. Fit the four cyan
quadratic boundaries with the edge arrows. WARP now resamples the actual image to
straighten those boundaries. The cyan outline itself follows the fitted bow; no second chord outline is shown. Select an edge arrow to use WASD, arrow keys or the directional pad with the shared Step Size. Corners stay primary; bows are normalized midpoint offsets with a
4% side-length limit. Off/on retains bows; Reset bows/new image clears them.

## Mapping

Let H(u,v) be the existing inverse projective homography from the output rectangle to
the source quad. For each side, evaluate H on that rectangle edge and project onto the
corresponding source chord to obtain its projective curve parameter t. Evaluate the
quadratic at t and subtract the chord point to obtain a displacement D. Then:

    P(u,v) = H(u,v) + (1-v) Dt(u) + v Db(u) + (1-u) Dl(v) + u Dr(v)

This is a Coons/transfinite interpolation of boundary *residuals*, added to a projective
base. All residuals vanish at corners, so the subtracted bilinear corner residual term
is zero. It is not a plain bilinear Coons patch: that would lose the original perspective
parameterization. Boundary restrictions reproduce the fitted quadratic with projective
parameterization. Zero residuals reproduce H. Top/right/bottom/left signs follow the
existing clockwise directed edges; outward bottom movement gives negative bottom bow.

One inverse sampling pass maps final output pixels directly to original-resolution source
pixels with bilinear interpolation. There is no intermediate warped bitmap, accumulated
resampling, or second homography pass. Output sizing and 63:88 behavior are unchanged.
Exactly zero bows call the historical warp renderer, so zero/reset output is bit-identical.
The original renderer's half-pixel sampling convention is preserved; the continuous domain
boundary lies at 0 and output-size-minus-one, as before.

## Rendering and safety

A cached WebGL texture holds the original photo. The fragment shader evaluates P and
samples it with LINEAR filtering. Bow updates are coalesced with requestAnimationFrame.
Each frame uses full output resolution. PNG serialization remains necessary for the
existing preview architecture. Missing WebGL, oversized textures, or GPU errors use the
same mapping in the existing Canvas inverse sampler, which may be slower on large images.

Existing 4% clamps and sampled curve-crossing checks remain. A 33x33 Jacobian check rejects
orientation inversion/near-collapse or extreme local stretch relative to H, and projective
poles are rejected. Unsafe maps show the normal perspective warp with a visible fallback
notice. Grid sampling is a practical safeguard, not a global mathematical proof for every
pathological quad. Severe curling and 3D reconstruction remain outside scope.

## Centering

Percentages come from opposing inner-guide insets in the WARP rectangle, not source bow
values. Initial automatic printed-border guesses inspect the transformed image. After bow
changes settle for 180ms, unedited guide pairs are guessed again using the dewarped image.
Manual guide pairs retain their user positions and must be reviewed/repositioned against
the new image; the assist copy explicitly instructs this. Percentages keep their existing
meaning and are not artificially changed in proportion to bow. They may remain unchanged
when an existing guide is retained, even though image pixels change.

## Diagnostics and tests

In development, Alt+G toggles the mapping grid on SOURCE while assist is enabled. Inspect
`.plane.curvedEdgeDiagnostics` for grid points, boundary samples and safety. Inspect the
source image element's `curvedRenderDiagnostics` for backend, time and fallback status.
These diagnostic properties/grid shortcuts are development-only.

Run from src/card-ui:

    node scripts/curved-mapping.test.cjs
    node --experimental-strip-types --test scripts/curved-edge.test.ts scripts/inner-border.test.ts scripts/tutorial.test.ts
    node scripts/test-edge-refinement.cjs
    node node_modules/typescript/bin/tsc --noEmit --pretty false

The mapping tests verify projective zero identity, all four boundary curves, multiple
bows, fixed corners, continuity and Jacobian safety. The previous curve tests validate
overlay/chord diagnostics; those chords are no longer the nonzero-bow sampling surface.
Browser regression script `test-curved-render.py` requires Python Playwright and Edge plus
a dev server at localhost:5174. It generates a bowed-bottom grid, compares GPU and CPU
pixels, verifies zero/reset identity, repeated-render identity, and live drag updates.

Measured synthetic output (263x368): approximately 22ms first GPU render and 2.3ms cached
render, including PNG generation, on this test machine. GPU/CPU mean absolute RGBA
channel difference was 0.00992/255. The red bowed boundary occupied 5.35% of the checked
bottom output row with perspective-only rendering and 100% after curved dewarping.
These are small-image measurements, not a performance guarantee for full camera photos.

The example deliberately has a bowed exterior and a regular interior grid: dewarping
straightens the boundary and visibly curves interior grid lines, demonstrating the smooth
image deformation. Real interior reconstruction depends on the actual deformation; four
boundary curves cannot uniquely recover a physically flat card or establish grading accuracy.
