# Vercel Monitor — регистрация интеграции (делается владельцем Nexus один раз)

Панель **Vercel Monitor** (Code Studio → вкладка «Vercel») подключается к аккаунту Vercel пользователя через **официальный
Vercel Integration flow** (установка интеграции → `code` → обмен на токен). Пользователь **не вводит API-токен**.

Зачем отдельная интеграция? Токен Vercel Integration ограничен scope'ами, которые вы задаёте при создании интеграции.
Интеграция «Управление» (Control Center, `VERCEL_INTEGRATION_*`) умеет деплоить и менять переменные, поэтому ей нужны write-права.
Монитор использует **собственную интеграцию только с правами Read** — так «только чтение» гарантируется на стороне Vercel,
а не только кодом Nexus. Существующая интеграция и вкладки GitHub / Chat / Work / Code Studio не меняются.

> Vercel не позволяет создавать Integration через API — только вручную в Dashboard. Поэтому без шагов ниже кнопка
> «Подключить Vercel» не появится, а панель честно покажет эту инструкцию (данные не имитируются).

## 1. Создайте интеграцию

Vercel → **Dashboard → Integrations → Developer / Create** (`https://vercel.com/dashboard/integrations/console`) → **Create**.

| Поле | Значение |
|---|---|
| Тип | **External** (connectable). Не «Native / Marketplace product» |
| Name | `Nexus Vercel Monitor` |
| **URL Slug** | `nexus-vercel-monitor` (любой свободный; попадёт в `https://vercel.com/integrations/<slug>/new`) |
| Developer / Contact e-mail | ваш e-mail |
| Short / Long description | «Read-only monitor of projects and deployments» |
| Logo | любое квадратное изображение |
| Website / Docs / Support / Privacy / Terms URL | `https://nexus-ide-lime.vercel.app` (или ваши страницы) |
| **Redirect URL** | `https://nexus-ide-lime.vercel.app/api/integrations/vercel-monitor/callback` |
| **Webhook URL** (необязательно) | `https://nexus-ide-lime.vercel.app/api/webhooks/vercel` |
| Webhook events | `integration-configuration.removed` (чтобы Nexus сразу забыл токен, если интеграцию удалили на Vercel) |
| Installation visibility | Public, если вы хотите, чтобы подключаться могли и другие пользователи; иначе Private |

Если домен другой — подставьте ваш `NEXUS_BASE_URL`. Точные значения Redirect/Webhook URL панель показывает сама (кнопка копирования), пока интеграция не настроена.

## 2. API Scopes — только чтение

| Scope | Уровень | Зачем |
|---|---|---|
| **Projects** (`project`) | **Read** | список проектов, фреймворк, репозиторий, домены |
| **Deployments** (`deployment`) | **Read** | деплои, статусы, ветка/коммит, build-логи |
| Team (`team`) | Read *(необязательно)* | только отображаемое имя команды |
| User (`user`) | Read *(необязательно)* | только отображаемое имя личного аккаунта |
| Всё остальное (`integration-configuration`, env-vars, domain, edge-config, drains, billing, deployment-check…) | **None** | не нужно |

Ни одного Read/Write. Эндпоинты, которыми пользуется монитор (все `GET`): `/v9/projects`, `/v6/deployments`,
`/v13/deployments/{id}`, `/v3/deployments/{id}/events`, `/v2/teams/{id}`, `/v2/user`.

## 3. Переменные окружения Nexus

После создания скопируйте **Client ID** и **Client Secret** (кнопка Generate) и добавьте в проект Vercel `nexus-ide`
(Settings → Environment Variables → Production), затем сделайте Redeploy:

```
VERCEL_MONITOR_CLIENT_ID=<Client ID интеграции>
VERCEL_MONITOR_CLIENT_SECRET=<Client Secret интеграции>
VERCEL_MONITOR_SLUG=<URL Slug интеграции>
```

Уже должны быть заданы (нужны для аккаунтов Nexus): `DATABASE_URL`, `NEXUS_ENCRYPTION_KEY`, `NEXUS_BASE_URL=https://nexus-ide-lime.vercel.app`.

## 4. Как это работает для пользователя

1. Войти в Nexus (GitHub / Vercel вход).
2. Code Studio → **Vercel** → **«Подключить Vercel»** → официальная страница установки Vercel → выбрать аккаунт/команду и проекты → подтвердить.
3. Vercel возвращает пользователя на Redirect URL; сервер Nexus обменивает одноразовый `code` на токен
   (`POST https://api.vercel.com/v2/oauth/access_token`), шифрует его AES-256-GCM и сохраняет в таблице `connected_providers`
   (`provider = vercel_monitor`) **только для этого пользователя**. В браузер токен не попадает никогда.
4. Отключение: кнопка выхода в панели удаляет токен из Nexus. Саму установку интеграции удаляют на
   `https://vercel.com/dashboard/integrations` (у монитора нет права `integration-configuration`, поэтому он не удаляет её сам).

## 5. Что панель делает и чего не делает

* Делает: список проектов, Production/Preview деплои, статусы Queued/Building/Ready/Error/Canceled, время запуска, ветку GitHub,
  коммит, ссылки на логи Vercel и просмотр последних строк build-лога, фильтры (проект / статус / окружение), историю с подгрузкой,
  автообновление (8 с при активных деплоях, иначе 30 с; пауза в фоновой вкладке) и кнопку «Обновить».
* Уведомления о неудачных деплоях: toast внутри Nexus + системные уведомления браузера (после разрешения) + колокольчик с
  журналом за 24 часа. **Работают, пока Nexus открыт** (в том числе в фоновой вкладке). Push при закрытом браузере не реализован —
  для него нужны Web Push/service worker и серверный планировщик.
* Не делает: не создаёт/не меняет/не удаляет проекты и деплои, не редеплоит, не отменяет, не трогает env-переменные.
  В коде нет ни одного не-GET запроса к Vercel из монитора (`src/lib/monitor/vercel-readonly.ts`, проверяется тестами).
