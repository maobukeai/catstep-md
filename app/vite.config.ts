import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (
            normalized.includes('/node_modules/tldraw/') ||
            normalized.includes('/node_modules/@tldraw/') ||
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/')
          ) {
            return 'tldraw';
          }
          if (
            normalized.includes('/node_modules/mermaid/') ||
            normalized.includes('/node_modules/d3') ||
            normalized.includes('/node_modules/dagre') ||
            normalized.includes('/node_modules/cytoscape') ||
            normalized.includes('/node_modules/cose-bilkent') ||
            normalized.includes('/node_modules/khroma')
          ) {
            return 'mermaid';
          }
          if (normalized.includes('/node_modules/katex/')) {
            return 'katex';
          }
          if (
            normalized.includes('/node_modules/@codemirror/') ||
            normalized.includes('/node_modules/codemirror/') ||
            normalized.includes('/node_modules/@replit/codemirror-vim/') ||
            normalized.includes('/node_modules/@lezer/')
          ) {
            return 'codemirror';
          }
          if (normalized.includes('/node_modules/docx/')) {
            return 'docx';
          }
          if (normalized.includes('/node_modules/highlight.js/')) {
            return 'highlight';
          }
          if (normalized.includes('/node_modules/prettier/')) {
            return 'prettier';
          }
          if (normalized.includes('/node_modules/opencc-js/')) {
            return 'opencc';
          }
          if (
            normalized.includes('/node_modules/html2pdf.js/') ||
            normalized.includes('/node_modules/html2canvas/') ||
            normalized.includes('/node_modules/jspdf/')
          ) {
            return 'html2pdf';
          }
          if (normalized.includes('/node_modules/reveal.js/')) {
            return 'reveal';
          }
        },
      },
    },
  },
}));
