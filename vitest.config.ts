import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      exclude: ['scripts/**', 'dist/**', '.pi/**', 'docs/.vitepress/**', 'vitest.config.ts']
    }
  }
});
