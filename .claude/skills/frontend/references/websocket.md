# Совместное редактирование

Канал: `{ws|wss}://{host}/ws/documents/{id}/?token=<access>[&link=<token>]`.
Реализация — `src/websocket/provider.ts` (`DocumentProvider`). Готовый
`y-websocket` не используется: у сервера свой протокол.

## Протокол

* **Двоичное сообщение** — приращение Yjs. Входящее применяется с
  `origin = 'remote'`, исходящее шлётся при локальном `update`.
* **JSON от сервера**: `sync_init`, `user_join`, `user_leave`,
  `presence_update`, `cursor_update`, `selection_update`, события обсуждения
  (`comment_*`) и правок (`suggestion_*`). Всё, что не про присутствие,
  уходит наверх через `onEvent` — страница по нему перечитывает панели.
* **JSON от клиента**: `cursor_update` (позиция и выделение) и `snapshot`
  (`content` — JSON ProseMirror, `state` — состояние Yjs в base64).
  Снимок отправляется раз в 60 с и при закрытии вкладки (`beforeunload`).

## Соединение

* Коды закрытия `4401…4404` — отказ в доступе, переподключение не выполняется.
* Иначе пауза удваивается от 1 с до 15 с.
* События `online`/`offline` окна переводят статус и поднимают соединение.

## Статусы для интерфейса

`SaveStatus`: `saved`, `saving`, `syncing`, `offline`, `error`. Подписи к ним —
в `pages/Editor.tsx` (`STATUS_LABELS`); выводить их в области с
`role="status"` и `aria-live="polite"`.

## Присутствие

`Presence` = `{ id, name, initials, color, avatar }`. Список участников
приходит из JSON-сообщений и хранится в провайдере; курсоры в тексте рисует
`CollaborationCursor` через `awareness`. Оба канала независимы — не пытаться
свести их в один.
