import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist-server',
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        entryFileNames: 'server.mjs',
      },
    },
    sourcemap: false,
    ssr: 'src/server/runtime/nodeMain.ts',
    target: 'node24',
  },
  ssr: {
    noExternal: true,
  },
});
