import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load environment variables based on current mode (e.g., .env / .env.local)
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      proxy: {
        '/api-0x': {
          target: 'https://api.0x.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-0x/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              // Inject mandatory 0x Headers
              proxyReq.setHeader('0x-api-key', env.VITE_ZEROX_API_KEY || env.ZEROX_API_KEY || '');
              proxyReq.setHeader('0x-version', 'v2');
              
              // Read chainId from incoming request header or query parameter, defaulting to Base (8453)
              const url = new URL(req.url, 'http://localhost');
              const chainId = req.headers['0x-chain-id'] || url.searchParams.get('chainId') || '8453';
              proxyReq.setHeader('0x-chain-id', chainId);
            });
          },
        },
      },
    },
  }
})