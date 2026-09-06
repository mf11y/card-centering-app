import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { modelFingerprintsPlugin } from './scripts/model-fingerprints.mjs';

export default defineConfig({ plugins: [modelFingerprintsPlugin(), tailwindcss(), sveltekit()] });
