import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxy only (the container image is served by nginx.conf instead).
// Defaults to localhost; set BACKEND_HOST when the services run somewhere else,
// e.g. `BACKEND_HOST=$(hostname -I | awk '{print $1}') npm run dev` from WSL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const host = env.BACKEND_HOST || 'localhost';
  const target = (port) => ({ target: `http://${host}:${port}`, changeOrigin: true });

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api/catalog': target(8081),
        '/api/auth': target(8082),
        '/api/bookings': target(8083),
        '/api/analyze': target(8084),
        '/api/analytics': target(8085),
      },
    },
  };
});
