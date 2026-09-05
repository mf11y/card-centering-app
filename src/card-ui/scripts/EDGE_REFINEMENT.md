# Browser edge refinement

`api.ts` now reconstructs native-resolution masks by unpadding and bilinearly
upsampling floating-point logits before thresholding and cropping. This follows
the installed Python Ultralytics `process_mask_native` / `retina_masks=True`
processing order. Mask-fit coordinates are already original-image pixels and
must not be inverse-letterboxed a second time.

After the mask fit, `refineCardImage` uses the original photograph. The returned
`corners` are the refined result, including any per-side/global fallback.
`original_corners` preserves the mask-fit result. `edge_refinement` includes
support, movement, acceptance and rejection diagnostics. Existing `refine_score`
and `quad_metrics` continue to describe the baseline mask fit, not refined accuracy.

The edge algorithm corresponds to `synthetic_card_dataset/card_edge_refinement.py`:

- Search radius max(3 px, 2.5% of shortest side); exclude 15% at both ends.
- Gaussian 5x5 sigma .8, Sobel /8, strongest directional color gradient.
- Gradient magnitude >=.018, alignment >=.65, Gaussian proximity prior.
- Subpixel peak adjustment, Huber fit, inlier refit.
- Inlier tolerance max(1.25 px, .3% of shortest side).
- Accept support >=45%, span >=65%, angle change <=5 degrees, offset <=85% radius.
- Reject invalid/nonconvex/out-of-image quads, corner movement >2 radii, or area
  ratio outside [.85,1.15]. Retain original geometry on rejection or exceptions.

Run regression tests from `src/card-ui`:

```sh
node scripts/test-edge-refinement.cjs
```

The mask fixtures were generated with PyTorch 2.11.0+cu128 and Ultralytics 8.4.140.
They check portrait/landscape/square unpadding, interpolation and fractional box
cropping. Edge tests cover perspective, occlusion, blank fallback and parameters.

The JS Huber solver uses deterministic IRLS instead of OpenCV's implementation;
browser image decoding and the existing mask fitter rasterization also differ.
This is algorithmic correspondence, not bitwise end-to-end parity. Four recorded
original-image fixtures matched Python edge acceptance decisions, with maximum
corner differences 0.310 px (test_edge), 0.141 px (70.jpg), 0.003 px (820.jpg), and
0 px (39.jpg fallback), when given the same initial quad and decoded pixels.

The ONNX model asset is not replaced by this change. Different checkpoint weights
or preprocessing can still change the initial segmentation. Refinement support
and silhouette overlap are not proof of physical-corner accuracy.
