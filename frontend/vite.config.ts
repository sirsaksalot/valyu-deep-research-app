import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Node's process, typed here so the build doesn't need @types/node
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [vue()],
  server: {
    // dev only: lets VITE_API_URL=/api reach a local backend through one origin
    // (handy for opening the dev server from a phone over Tailscale)
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: process.env.API_PROXY ?? "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
