import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/integrations/index.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
})
