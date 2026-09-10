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
        // Редактор и CRDT — самые тяжёлые части. Отдельными файлами они
        // кешируются у пользователя и не тянутся заново при каждой правке кода.
        manualChunks: {
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/pm'],
          crdt: ['yjs', 'y-prosemirror', 'y-protocols', 'y-indexeddb'],
        },
      },
    },
  },
})
