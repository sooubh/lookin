import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isDev = process.argv.includes('--watch');

async function build() {
  const outDir = path.resolve('extension/dist');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Ensure sidepanel directory exists in dist
  const sidepanelDist = path.join(outDir, 'sidepanel');
  if (!fs.existsSync(sidepanelDist)) {
    fs.mkdirSync(sidepanelDist, { recursive: true });
  }

  // Copy manifest and html
  fs.copyFileSync('extension/manifest.json', path.join(outDir, 'manifest.json'));
  fs.copyFileSync('extension/src/sidepanel/index.html', path.join(sidepanelDist, 'index.html'));

  console.log('[Build] Compiling TypeScript declaration and modules...');
  const { execSync } = await import('child_process');
  execSync('npx tsc', { stdio: 'inherit' });

  console.log('[Build] Building extension bundles with esbuild...');

  // 1. Background Service Worker
  await esbuild.build({
    entryPoints: ['extension/src/background.ts'],
    outfile: path.join(outDir, 'background.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  });

  // 2. Content Script
  await esbuild.build({
    entryPoints: ['extension/src/content.ts'],
    outfile: path.join(outDir, 'content.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  });

  // 3. Sidepanel Application
  await esbuild.build({
    entryPoints: ['extension/src/sidepanel/app.ts'],
    outfile: path.join(sidepanelDist, 'app.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  });

  console.log('[Build] Extension successfully compiled to extension/dist/');
}

build().catch((err) => {
  console.error('[Build] Build failed:', err);
  process.exit(1);
});
