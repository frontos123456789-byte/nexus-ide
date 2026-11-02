# Nexus AI — настройка OAuth, GitHub App и Vercel Integration

Этот документ описывает, **что владелец Nexus должен сделать вручную** у GitHub и Vercel. Код Nexus уже готов,
но без ваших приложений кнопки входа честно покажут «Не настроено владельцем» — подставных Client ID в проекте нет и не будет.

> Требования провайдеров сверены с официальной документацией GitHub и Vercel (раздел «Источники» внизу).
> Если интерфейс провайдера изменился — ориентируйтесь на названия полей, а не на расположение кнопок.

## 0. Что и зачем

| Задача | Механизм | Что получает Nexus |
|---|---|---|
| Вход через GitHub | GitHub OAuth (OAuth App **или** OAuth-часть GitHub App) + `state` + PKCE | id, login, имя, аватар |
| Доступ к репозиториям | **GitHub App** (установка пользователем, выбор репозиториев) | короткоживущие *installation access tokens* (1 час), выпускаются на сервере |
| Вход через Vercel | **Sign in with Vercel** (OIDC, code + PKCE S256) | id, имя, username, аватар (только идентификация) |
| Доступ к проектам Vercel | **Vercel Integration** (установка пользователем, обмен `code` → токен) | токен REST API в пределах прав интеграции |

### ⚠️ Ограничение Vercel (не имитируется)

«Sign in with Vercel» выдаёт токены **только для идентификации** (`openid email profile offline_access`).
Права на REST API (проекты, деплои, переменные) для этих токенов в документации Vercel помечены как **private beta**.
Поэтому в Nexus:

* кнопка «Продолжить через Vercel» = вход (подтверждение личности);
* кнопка «Подключить Vercel» = официальная **установка Vercel Integration** — единственный публично поддерживаемый путь
  получить токен REST API от имени пользователя/команды.

Если Vercel откроет API-права для Sign in with Vercel, Nexus можно будет упростить до одного шага.

---

## 1. Общие вещи

### 1.1 Домен и HTTPS

Продакшен **обязан** работать по HTTPS (cookie с `Secure` и префиксом `__Host-`). Ниже `https://YOUR-DOMAIN` — публичный адрес Nexus,
например `https://nexus-ide.vercel.app`. Задайте его явно:

```
NEXUS_BASE_URL=https://YOUR-DOMAIN
```

Фиксированный `NEXUS_BASE_URL` защищает от подмены заголовка `Host` при построении callback-URL. Без него на Vercel используется
`VERCEL_PROJECT_PRODUCTION_URL`, иначе — адрес запроса.

Для локальной разработки: `http://localhost:3000` (GitHub и Vercel разрешают `localhost` в callback-URL; `Secure`-cookie на localhost браузеры принимают).

### 1.2 Ключ шифрования токенов

```
openssl rand -base64 32      # → NEXUS_ENCRYPTION_KEY
```

Без `NEXUS_ENCRYPTION_KEY` в production Nexus **не сохраняет** ни один токен провайдера (вход блокируется с понятной ошибкой).
Ротация: новый ключ в `NEXUS_ENCRYPTION_KEY`, старый — в `NEXUS_ENCRYPTION_KEY_PREVIOUS` (используется только для расшифровки).
После переноса всех записей старый ключ можно удалить.

### 1.3 База данных

`DATABASE_URL=postgres://…` — обязательна для аккаунтов (пользователи, сессии, подключения, аудит).
Таблицы создаются автоматически при первом обращении (идемпотентный DDL с advisory-lock) либо командой `npx drizzle-kit push`.
Подойдёт любой Postgres (Neon, Supabase, Vercel Marketplace Postgres и т. д.).

---

## 2. GitHub

Есть два рабочих варианта входа. **Рекомендуемый — один GitHub App на всё** (вход + доступ к репозиториям): меньше настроек.
Классический OAuth App нужен только если хотите отделить вход от доступа.

### 2.1 Вариант A (опционально): GitHub OAuth App — только вход

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Заполните:
   * **Application name**: Nexus AI
   * **Homepage URL**: `https://YOUR-DOMAIN`
   * **Authorization callback URL**: `https://YOUR-DOMAIN/api/auth/callback/github`
3. **Register application → Generate a new client secret**.
4. Переменные окружения:
   ```
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```
   Запрашиваемые scope: `read:user user:email` (никакого `repo`!). Доступ к репозиториям идёт только через GitHub App.

### 2.2 GitHub App (обязательно для работы с репозиториями)

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
   (для организации: *Organization settings → Developer settings → GitHub Apps*).
2. Поля:
   * **GitHub App name**: например `nexus-ai-yourname` (уникальное; из него получится *slug* в URL `github.com/apps/<slug>`).
   * **Homepage URL**: `https://YOUR-DOMAIN`
   * **Callback URL**: `https://YOUR-DOMAIN/api/auth/callback/github`
   * **Expire user authorization tokens**: ✅ включить (Nexus обновляет такие токены через refresh token).
   * **Request user authorization (OAuth) during installation**: можно оставить выключенным.
   * **Setup URL (optional)**: `https://YOUR-DOMAIN/api/integrations/github/callback`
   * **Redirect on update**: ✅ включить.
   * **Webhook → Active**: ✅
     * **Webhook URL**: `https://YOUR-DOMAIN/api/webhooks/github`
     * **Webhook secret**: сгенерируйте (`openssl rand -hex 32`) → `GITHUB_APP_WEBHOOK_SECRET`.
     Подпись `X-Hub-Signature-256` проверяется до разбора payload.
3. **Permissions** (минимально необходимые; всё остальное — *No access*):

   | Раздел | Право | Для чего |
   |---|---|---|
   | Repository → **Metadata** | Read | обязательно для любого App |
   | Repository → **Contents** | Read & write | файлы, ветки, коммиты |
   | Repository → **Pull requests** | Read & write | создание и просмотр PR |
   | Repository → **Actions** | Read-only (или Read & write для перезапуска) | просмотр GitHub Actions |
   | Repository → **Workflows** | Read & write | *только если* агенты должны править `.github/workflows/*` |
   | Repository → **Administration** | Read & write | *только если* нужно создавать репозитории в организациях |

   Права можно сузить позже; пользователи увидят изменения прав и подтвердят их на GitHub.
4. **Subscribe to events** (по желанию): `Push`, `Pull request`, `Workflow run`. События `installation` /
   `installation_repositories` / `github_app_authorization` GitHub шлёт Apps автоматически — по ним Nexus сразу
   отзывает подключение, если пользователь удалил App на GitHub.
5. **Where can this GitHub App be installed?** — *Any account* (если им будут пользоваться другие люди) или *Only on this account*.
6. **Create GitHub App**. На странице App:
   * скопируйте **App ID** и **Client ID**, нажмите **Generate a new client secret**;
   * внизу **Generate a private key** — скачается `.pem`.
7. Переменные окружения:
   ```
   GITHUB_APP_ID=123456
   GITHUB_APP_SLUG=nexus-ai-yourname
   GITHUB_APP_CLIENT_ID=Iv1....            # нужен для входа, если не задан GITHUB_OAUTH_CLIENT_ID
   GITHUB_APP_CLIENT_SECRET=...
   GITHUB_APP_PRIVATE_KEY=...              # см. ниже
   GITHUB_APP_WEBHOOK_SECRET=...
   ```
   **Приватный ключ** положите либо целиком с экранированными переводами строк
   (`-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----`), либо в base64:
   ```
   base64 -w0 your-app.private-key.pem        # Linux
   base64 -i your-app.private-key.pem         # macOS
   ```
   Ключ используется **только на сервере** для подписи короткоживущего JWT (RS256, 9 минут) — им выпускаются installation tokens.
8. Как это работает для пользователя: «Установить GitHub App» → страница GitHub → пользователь **сам выбирает репозитории** →
   возврат на Setup URL. Nexus проверяет принадлежность установки токеном **самого пользователя**
   (`GET /user/installations`), а не доверяет `installation_id` из URL. Дополнительно пользователь может сузить список
   репозиториев на уровне Nexus («Аккаунт и подключения → GitHub → Только выбранные»): тогда токен запрашивается
   только на эти репозитории.

---

## 3. Vercel

### 3.1 Sign in with Vercel (вход)

1. Vercel → **Team Settings → Apps → Create**.
2. Задайте **Name** и **Slug**.
3. Страница **Manage** приложения:
   * **Authorization Callback URLs** → добавьте `https://YOUR-DOMAIN/api/auth/callback/vercel`
     (для разработки ещё `http://localhost:3000/api/auth/callback/vercel`).
   * **Authentication**: достаточно `client_secret_post` (или `client_secret_basic`). Нажмите **Generate** для client secret.
   * **Permissions** (scopes): `openid`, `email`, `profile`, `offline_access`.
   * **Sign-In Access**: *Anyone with a Vercel account* (если приложением будут пользоваться все).
4. Переменные окружения:
   ```
   VERCEL_APP_CLIENT_ID=...
   VERCEL_APP_CLIENT_SECRET=...
   ```
   (Допустим также `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, как в примерах Vercel.)

Nexus использует code flow + PKCE (S256) + `state` + `nonce`; ID-токен проверяется по `aud`, `exp`, `nonce`.

### 3.2 Vercel Integration («Подключить Vercel» — доступ к API)

1. Vercel → **Dashboard → Integrations → Developer / Create** (*Integrations Console*), либо
   `https://vercel.com/dashboard/integrations/console`. Тип: **external / connectable** интеграция (не «native product»).
2. Заполните обязательные поля карточки (название, **slug**, контакты, иконка, описание, URL сайта/документации/политик).
   Slug попадает в ссылку установки: `https://vercel.com/integrations/<slug>/new`.
3. **Redirect URL**: `https://YOUR-DOMAIN/api/integrations/vercel/callback`
   (для разработки допускается `localhost`).
4. **API Scopes** (выбирайте минимально необходимое):

   | Scope | Уровень | Зачем |
   |---|---|---|
   | `project` | Read/Write | список и создание проектов |
   | `deployment` | Read/Write | деплои, redeploy, логи |
   | `global-project-env-vars` | Read/Write | управление переменными окружения проектов (`project-env-vars` видит только переменные, созданные самой интеграцией) |
   | `team` | Read | список команд |
   | `user` | Read | имя аккаунта |
   | `integration-configuration` | Read/Write | **обязателен** — отключение: Nexus вызывает `DELETE /v1/integrations/configuration/{id}`, это единственный способ отозвать токен |

5. **Webhooks** (рекомендуется): URL `https://YOUR-DOMAIN/api/webhooks/vercel`, событие `integration-configuration.removed`.
   Подпись `x-vercel-signature` (HMAC-SHA1 тела, ключ — Client Secret интеграции) проверяется до разбора payload.
6. Сохраните интеграцию, скопируйте **Client ID** и **Client Secret**.
7. Переменные окружения:
   ```
   VERCEL_INTEGRATION_SLUG=your-slug
   VERCEL_INTEGRATION_CLIENT_ID=oac_...
   VERCEL_INTEGRATION_CLIENT_SECRET=...
   ```
8. Видимость интеграции (Private/Public) и публикация в Marketplace регулируются Vercel — проверьте в консоли интеграций,
   кто может её устанавливать. Для публичного листинга Vercel требует EULA, Privacy Policy и проходит ревью.

Поток: «Подключить Vercel» → всплывающее окно `vercel.com/integrations/<slug>/new?state=…` → пользователь выбирает аккаунт/команду
и подтверждает права → Vercel вызывает Redirect URL с `code` → Nexus **на сервере** меняет `code` на токен
(`POST /v2/oauth/access_token`), шифрует его (AES-256-GCM) и привязывает к пользователю Nexus. `state` связан с cookie браузера
и с активной сессией Nexus, «чужой» `next` не принимается (разрешены только `*.vercel.com`).

---

## 4. Сводка callback-URL

| Назначение | URL |
|---|---|
| GitHub OAuth / GitHub App → Callback URL | `https://YOUR-DOMAIN/api/auth/callback/github` |
| GitHub App → Setup URL (+ «Redirect on update») | `https://YOUR-DOMAIN/api/integrations/github/callback` |
| GitHub App → Webhook URL | `https://YOUR-DOMAIN/api/webhooks/github` |
| Sign in with Vercel → Authorization Callback URL | `https://YOUR-DOMAIN/api/auth/callback/vercel` |
| Vercel Integration → Redirect URL | `https://YOUR-DOMAIN/api/integrations/vercel/callback` |
| Vercel Integration → Webhook URL | `https://YOUR-DOMAIN/api/webhooks/vercel` |

## 5. Переменные окружения (итог)

| Переменная | Обязательна | Назначение |
|---|---|---|
| `DATABASE_URL` | да | PostgreSQL |
| `NEXUS_ENCRYPTION_KEY` | да (prod) | шифрование токенов (AES-256-GCM) |
| `NEXUS_ENCRYPTION_KEY_PREVIOUS` | нет | ротация ключа |
| `NEXUS_BASE_URL` | рекомендуется | публичный HTTPS-адрес Nexus |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | вариант A | вход через GitHub OAuth App |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | да (доступ к репозиториям) | GitHub App |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | если нет OAuth App | вход через GitHub App |
| `GITHUB_APP_WEBHOOK_SECRET` (или `GITHUB_WEBHOOK_SECRET`) | рекомендуется | проверка подписи вебхуков GitHub |
| `VERCEL_APP_CLIENT_ID` / `VERCEL_APP_CLIENT_SECRET` | для входа через Vercel | Sign in with Vercel |
| `VERCEL_INTEGRATION_SLUG` / `_CLIENT_ID` / `_CLIENT_SECRET` | для «Подключить Vercel» | Vercel Integration |

Устаревшие (оставлены на время перехода): `NEXUS_ADMIN_KEY`, `GITHUB_TOKEN`/`VERCEL_TOKEN` (owner-режим) и ручной ввод PAT
в Control Center → «Подключение» → «Устаревший способ». Их планируется удалить после проверки новых потоков на реальных аккаунтах.

## 6. Что владелец делает вручную (чек-лист)

- [ ] Создать **GitHub App** (§2.2) — получить App ID, slug, Client ID/Secret, private key, webhook secret.
- [ ] *(опц.)* Создать **GitHub OAuth App** (§2.1).
- [ ] Создать **Sign in with Vercel App** (§3.1).
- [ ] Создать **Vercel Integration** (§3.2) — получить slug, Client ID/Secret.
- [ ] Завести `DATABASE_URL`, `NEXUS_ENCRYPTION_KEY`, `NEXUS_BASE_URL`.
- [ ] Прописать переменные окружения в Vercel (Project → Settings → Environment Variables) и сделать redeploy.
- [ ] Пройти ручную проверку (§7) на реальных аккаунтах.

## 7. Ручная проверка на реальных аккаунтах

Автоматические тесты (`npm test`) проверяют **логику Nexus** (state, PKCE, сессии, изоляцию, права, вебхуки, шифрование)
на реальной PostgreSQL с имитацией ответов провайдеров. Они **не доказывают**, что ваши приложения у GitHub/Vercel
зарегистрированы верно. После настройки пройдите:

1. `/login` → «Продолжить через GitHub» → согласие на github.com → возврат в Nexus залогиненным.
2. Выйти и войти снова → тот же аккаунт (без дубликата).
3. Перезагрузить страницу/вкладку → сессия сохранена.
4. Настройки → «Аккаунт и подключения» → «Установить GitHub App» → выбрать репозитории → они видны в списке.
5. «Только выбранные» → Control Center открывает только отмеченные репозитории.
6. «Привязать вход через Vercel» и «Подключить Vercel» → список проектов отображается.
7. На github.com/settings/installations удалить App → Nexus показывает «Не подключён» (вебхук) или «доступ отозван».
8. «Отключить» у Vercel → интеграция исчезает в `vercel.com/dashboard/integrations`.
9. Нажать «Отмена» на экране согласия → понятное сообщение, ничего не создано.
10. С телефона (или DevTools) пройти пп. 1–6.

## 8. Безопасность — что реализовано

* OAuth `state` (256 бит) в зашифрованной HttpOnly-cookie, сравнение за постоянное время, одноразовая; PKCE S256; `nonce` для OIDC.
* Cookie сессии: `HttpOnly; Secure; SameSite=Lax; Path=/` + префикс `__Host-` на HTTPS; в БД хранится только SHA-256 токена.
* Сессии: абсолютный срок 30 дней, idle-таймаут 7 дней, новая сессия при каждом входе (защита от fixation), «выйти на всех устройствах».
* Привязка провайдера — только внутри подтверждённой сессии, связанной с `state`; аккаунты **никогда** не объединяются по e-mail;
  чужой идентификатор провайдера привязать нельзя.
* Токены провайдеров шифруются AES-256-GCM с привязкой (AAD) к пользователю; в браузер, URL и логи не попадают.
  GitHub: токены установки живут ≤ 1 часа, выпускаются на сервере и не хранятся.
* CSRF для изменяющих запросов: заголовок `x-nexus-csrf` + проверка `Origin`.
* Проверка прав и владельца ресурса на сервере (ключ поиска — пользователь сессии); allow-list репозиториев и env-ключей;
  production-деплой, redeploy, удаление и создание PR/коммитов требуют явного подтверждения.
* Rate limiting на auth/API (best-effort, in-memory на экземпляр — для серьёзной нагрузки добавьте внешний лимитер, например Upstash/Vercel Firewall).
* Вебхуки: HMAC GitHub (SHA-256) и Vercel (SHA-1) проверяются до разбора тела.
* Отзыв: отключение GitHub (+ опционально удаление установки на GitHub), удаление Vercel-интеграции на стороне Vercel, отвязка
  идентичности с отзывом OAuth-гранта GitHub.

## Источники

* GitHub: *Creating a GitHub App*, *Authenticating as a GitHub App installation*, *Generating a user access token for a GitHub App*,
  *Authorizing OAuth apps* (docs.github.com).
* Vercel: *Sign in with Vercel* (Getting started, Authorization Server API, Scopes and Permissions, Manage from the Dashboard),
  *Building Integrations with Vercel REST API*, *Requirements for listing an Integration* (vercel.com/docs).
