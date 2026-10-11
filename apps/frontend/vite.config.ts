import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.FRONTEND_PORT) || 3012;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});
