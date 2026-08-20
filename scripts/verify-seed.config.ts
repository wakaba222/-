import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** 検証スクリプトを TypeScript のまま実行するための最小構成 (エイリアス解決のみ) */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: {
    ssr: true,
    target: 'node22',
    outDir: fileURLToPath(new URL('../.verify', import.meta.url)),
    rollupOptions: { input: fileURLToPath(new URL('./verify-seed.ts', import.meta.url)) },
  },
});
