import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The model stays in one place, src/model/model.json, where the tests and the parity check read
// it. The desk's Try a ticket loads it from models/shipped.json, so the build copies it there
// rather than keeping a second file in the repo.
function shippedModel(): Plugin {
  return {
    name: 'shipped-model',
    writeBundle() {
      mkdirSync(`${ROOT}dist/models`, { recursive: true });
      copyFileSync(`${ROOT}src/model/model.json`, `${ROOT}dist/models/shipped.json`);
    },
  };
}

// Relative asset and model paths, so the built page works from any folder it is served from.
// Three pages come from one build: the desk (the site root), Under the Hood and Model History. The manifest tells
// the size check which files each page loads.
export default defineConfig({
  base: './',
  plugins: [shippedModel()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        desk: `${ROOT}index.html`,
        'under-the-hood': `${ROOT}under-the-hood.html`,
        'model-history': `${ROOT}model-history.html`,
      },
    },
  },
});
