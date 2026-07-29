import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'dist-server-dev',
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        entryFileNames: 'server.mjs',
      },
    },
    sourcemap: true,
    ssr: 'src/server/runtime/nodeDevMain.ts',
    target: 'node24',
  },
  ssr: {
    noExternal: true,
  },
});
