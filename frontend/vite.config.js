import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/status': 'http://localhost:9000',
      '/start': 'http://localhost:9000',
      '/stop': 'http://localhost:9000',
      '/logs': 'http://localhost:9000',
      '/upload': 'http://localhost:9000',
      '/wol': 'http://localhost:9000'
    }
  }
});