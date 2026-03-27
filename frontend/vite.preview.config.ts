import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config that builds SpecPreview into a standalone IIFE bundle
 * (preview-bundle.js + style.css) for use by deployed apps.
 *
 * Run: npm run build:preview
 * Output: dist-preview/preview-bundle.js, dist-preview/style.css
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/preview-bundle.tsx"),
      name: "IsibiPreview",
      formats: ["iife"],
      fileName: () => "preview-bundle.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // Ensure CSS is extracted as a separate file
        assetFileNames: "preview-bundle.[ext]",
      },
    },
    cssCodeSplit: false,
    minify: true,
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
