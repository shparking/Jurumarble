// 테스트 주입용 빌드: React/Firebase는 CDN(esm.sh)에서 로드 → 앱 코드만 작게 뽑음
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'test-build',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.jsx',
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'firebase/app', 'firebase/database'],
      output: { entryFileNames: 'app.js', assetFileNames: 'app.[ext]', format: 'es', inlineDynamicImports: true },
    },
  },
})
