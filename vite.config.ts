import { preact } from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const testExcludes = ['**/node_modules/**', '**/dist/**', '**/.git/**'];

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: [...testExcludes, 'tests/**/*.node.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.node.test.{ts,tsx}'],
          exclude: testExcludes,
        },
      },
    ],
  },
});
