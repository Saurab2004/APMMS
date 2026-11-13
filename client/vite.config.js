import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the React app (port 5173) forwards /api and /socket.io to the Express server (port 5000).
// Because the browser only talks to one origin, the secure HttpOnly login cookie "just works".
const API = process.env.VITE_API_TARGET || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true, changeOrigin: false },
    },
  },
});
