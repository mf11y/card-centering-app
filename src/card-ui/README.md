# Card Centering frontend

The SvelteKit application for the Card Centering workspace. See the [repository README](../../README.md) for features, usage, architecture, image-storage behavior, and deployment notes.

## Development

From this directory, with Node.js 22.18+ and npm:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the URL printed by Vite. No separate Python inference server is required. Model files live in `static/models/` and must be present when Vite starts.

## Build

```sh
npm run build
npm run preview
```

The deployment adapter targets Vercel. Production-mode upload capture needs private Blob storage configuration, including when using local preview; capture errors do not prevent browser processing.

## Technical references

- [Upload capture and server configuration](../../UPLOAD_LOGGING.md)
- [Recent-upload cache and compatibility versioning](RECENT_UPLOAD_CACHE.md)
- [Learned inner-border ranker and rollback](LEARNED_INNER_RANKER.md)
- [Curved Edge Assist](scripts/CURVED_EDGE_ASSIST.md)
- [Outer edge refinement](scripts/EDGE_REFINEMENT.md)

Targeted checks and browser-cache test instructions are linked from the repository README. Run commands from this directory unless a document says otherwise.
