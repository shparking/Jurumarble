// 단일 HTML 파일 빌드 (더블클릭으로 열어 UI 확인용): npm run build:single → single/index.html
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'single', emptyOutDir: true },
})
