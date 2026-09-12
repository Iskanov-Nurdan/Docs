# REST API

Базовый адрес — `VITE_API_URL` или `/api` (тот же origin, проксирует nginx).

## Транспорт (`src/api/client.ts`)

* `request<T>(path, { method, body, params, formData, retry })`.
* Заголовок `Authorization: Bearer` подставляется автоматически из `tokens`.
* При `401` выполняется одно общее обновление пары токенов на все параллельные
  запросы, затем один повтор. Второго повтора нет — не добавлять.
* Пустые значения в `params` не попадают в строку запроса.
* `204` → `undefined`; ошибка → `ApiError(status, detail, code, fields)`.
* `formData` отправляется без `Content-Type` — браузер ставит boundary сам.

Токены: `tokens.access`, `tokens.refresh`, `tokens.set()`, `tokens.clear()`
(`localStorage`, ключи `docs.access` / `docs.refresh`).

## Эндпоинты (все методы уже описаны в `src/api/index.ts`)

Учётная запись
: `auth/login|logout|refresh|confirm-email` (регистрации нет),
  `auth/password/reset`, `auth/password/reset/confirm`, `auth/password/change`,
  `users/me` (GET/PATCH), `users/search?q=`.

Администрирование (только `is_staff`)
: `admin/users/` GET (поиск через `q`, постранично) и POST (завести человека:
  `email`, `password`, `first_name`, `last_name`, `role`), `admin/users/{id}/`
  PATCH (`role`, `is_active`), `admin/summary/`. Роль `admin` доступна только
  главному админу — сервер ответит 403.

Документы
: `documents/` (list с `scope`, `q`, `folder`, `ordering`, `page_size`),
  POST (`title`, `folder_id`, `template_id`), `documents/{id}/` GET/PATCH/DELETE
  (`?permanent=true`), `restore`, `copy`, `star`, `activity`, `documents/search`.

`scope` — `active` (свои и доступные), `starred`, `trash` (только удалённые
владельцем), `search`, `shared` (доступ выдан другим пользователем).

Папки
: `folders/` GET/POST, `folders/{id}/` PATCH/DELETE. Дерево строится на клиенте
  из плоского списка по полю `parent`. При удалении папки документы переезжают
  в корень, а не в корзину.

Доступ
: `documents/{id}/permissions/` GET/POST, `.../permissions/{permissionId}/`
  PATCH/DELETE, `documents/{id}/share-link/` PUT, `share/{token}/` GET.
  Ссылка доступа передаётся в запрос документа параметром `link`.

Версии
: `documents/{id}/versions/` GET/POST, `versions/{versionId}/` GET,
  `versions/{versionId}/restore/` POST.

Шаблоны
: `templates/?category=&blocks=`, `templates/{id}/` (с содержимым).

Уведомления
: `notifications/?unread=true` (в ответе есть `unread_count`),
  `notifications/{id}/read/`, `notifications/read-all/`.

Файлы
: `files/images/` (multipart `file`, `document_id`), `documents/{id}/export/?format=`
  (возвращает `task_id`), `exports/{taskId}/` (`status`, `file.url`).
  Форматы: `xlsx`, `csv`, `pdf`, `docx`, `txt`, `html`.
  Выгрузку выполняет Celery — опрашивать статус с интервалом ~1 с.

Публикация
: `documents/{id}/publish/` GET/POST/DELETE, `published/{publicId}/`.

## Ответы списков

Постраничные ответы приходят как `Paginated<T>`:
`{ count, page, pages, page_size, results }`. Часть эндпоинтов
(`folders`, `comments`, `versions`, `templates`, `documents/search`) отдаёт
обычный массив — смотреть сигнатуру метода в `src/api/index.ts`.
