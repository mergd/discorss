import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            'styled-system': fileURLToPath(new URL('./styled-system', import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3001',
            '/auth': 'http://localhost:3001',
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
