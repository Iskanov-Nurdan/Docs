# Разработка: сервер Vite с горячей перезагрузкой.
FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Сборка боевой версии.
FROM node:22-alpine AS builder
WORKDIR /app

# Адрес API и канала правок Vite подставляет в код на сборке. Менять их
# переменными окружения у готового образа поздно — там уже статика.
ARG VITE_API_URL=/api
ARG VITE_WS_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# Раздача статики: nginx отдаёт собранные файлы, приложение одностраничное.
FROM nginx:1.27-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
