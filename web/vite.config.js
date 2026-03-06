import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }
                    if (id.includes('@tanstack/react-query') || id.includes('@tanstack/react-router')) {
                        return 'tanstack';
                    }
                    if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\') || id.includes('scheduler')) {
                        return 'react';
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/.well-known': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
});
