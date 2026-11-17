import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [tailwindcss()], build: { outDir: 'dist/ui' }, server: { proxy: { '/api': 'http://127.0.0.1:47831' } } });
