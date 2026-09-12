import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Тот же алиас, что и в tsconfig: без него сборщик не найдёт '@/...',
    // хотя редактор кода подсказывает пути правильно.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // В контейнере опрос файлов надёжнее событий файловой системы:
    // иначе горячая перезагрузка молча перестаёт срабатывать.
    watch: { usePolling: true },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // CRDT — самая тяжёлая часть приложения. Отдельным файлом он кешируется
        // у пользователя и не тянется заново при каждой правке кода.
        // Здесь только пакеты с корневым экспортом: y-protocols состоит из
        // подпутей (y-protocols/awareness), корневой точки входа у него нет —
        // сборка на нём падает. В общий чанк он попадёт с тем, что его тянет.
        manualChunks: {
          crdt: ['yjs', 'y-indexeddb'],
        },
      },
    },
  },
})
