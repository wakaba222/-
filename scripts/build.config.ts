import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * 運用スクリプトを TypeScript のまま実行するための最小構成。
 * アプリと同じ `@/` エイリアスでドメイン層を再利用できるようにするのが目的。
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: {
    ssr: true,
    target: 'node22',
    outDir: fileURLToPath(new URL('../.verify', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'seed-users': fileURLToPath(new URL('./seed-users.ts', import.meta.url)),
        'verify-seed': fileURLToPath(new URL('./verify-seed.ts', import.meta.url)),
        'verify-remote': fileURLToPath(new URL('./verify-remote.ts', import.meta.url)),
        'apply-sql': fileURLToPath(new URL('./apply-sql.ts', import.meta.url)),
        'purge-demo-data': fileURLToPath(new URL('./purge-demo-data.ts', import.meta.url)),
        'create-coaches': fileURLToPath(new URL('./create-coaches.ts', import.meta.url)),
        'verify-authz': fileURLToPath(new URL('./verify-authz.ts', import.meta.url)),
      },
    },
  },
});
