#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { resolve } from 'path';

// HTML plugin for esbuild
const htmlPlugin = {
  name: 'html',
  setup(build) {
    build.onResolve({ filter: /\.html$/ }, args => ({
      path: resolve(args.resolveDir, args.path),
      namespace: 'html-ns'
    }));

    build.onLoad({ filter: /.*/, namespace: 'html-ns' }, args => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf-8'))}`,
      loader: 'js'
    }));
  }
};

const esbuild = await import('./node_modules/esbuild/lib/main.js');

await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'esm',
  target: 'esnext',
  platform: 'browser',
  plugins: [htmlPlugin],
  minify: false,
  sourcemap: false,
});

console.log('✅ Build completed');
