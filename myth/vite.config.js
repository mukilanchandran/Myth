import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // '/' for a normal host (Netlify, Vercel, Docker, any domain root).
  // Set VITE_BASE=/repo-name/ only for a GitHub Pages *project* site.
  base: process.env.VITE_BASE || '/',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // vendor code is split below, so anything still large is worth a second look
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code so app edits don't bust the whole cache.
        // Rolldown (Vite 8) requires the function form here.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-editor';
          if (id.includes('recharts') || /node_modules[\\/]d3-/.test(id)) return 'vendor-charts';
          if (id.includes('@mantine')) return 'vendor-mantine';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('@tabler')) return 'vendor-icons';
          if (id.includes('pdfjs-dist')) return 'vendor-pdf';      // only loaded when a PDF is dropped
          if (id.includes('qrcode')) return 'vendor-qr';
          return 'vendor';
        },
      },
    },
  },

  // 5180, not Vite's default 5173: another local project already serves localhost:5173.
  // strictPort fails loudly instead of silently sharing a port again.
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 4173, host: true },
});
