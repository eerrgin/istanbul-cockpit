import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['utils.js']
    }
  }
});
