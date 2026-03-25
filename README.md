# Builder Sales Bot

Telegram-бот для продаж и поддержки строительной компании. Проект реализован как монорепо с `NestJS` API, `Next.js` backoffice, Prisma/PostgreSQL, Redis-очередями и AI-оркестрацией через OpenAI Responses API.

## Структура

- `apps/api` - backend, webhook, admin API, AI orchestration.
- `apps/admin` - внутренняя админка для каталога, лидов и базы знаний.
- `apps/worker` - фоновые задачи: уведомления, embeddings, офлайн-обработка.
- `packages/domain` - общие типы, схемы и контракты.
- `packages/config` - конфигурационные константы.
- `packages/ui` - минимальный UI-kit для backoffice.
- `infra/prisma` - схема базы, миграции и seed.
- `content/playbook` - стартовый sales playbook.
- `content/evals` - регрессионные AI-сценарии.

## Быстрый старт

1. Скопируйте `.env.example` в `.env`.
2. Поднимите локальную инфраструктуру:

```bash
docker compose up -d
```

3. Установите зависимости и сгенерируйте Prisma Client:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

4. Запустите сервисы:

```bash
npm run dev
npm run dev:worker
npm run dev:admin
```

## Ключевые ручки

- `POST /webhooks/telegram`
- `GET /health`
- `GET /ready`
- `GET /admin/dashboard`
- `POST /admin/projects`
- `POST /admin/units`
- `POST /admin/knowledge-documents`
- `POST /admin/leads/:id/assign`
- `POST /admin/support-tickets`

## Что уже заложено

- Контракт `AIDecision` со строгой валидацией.
- Политика против галлюцинаций по ценам, доступности и юридическим обещаниям.
- Fallback AI-режим без OpenAI ключа для локальной разработки.
- `Telegram polling` режим для деплоя без домена и HTTPS.
- `QUEUE_MODE=inline` для дешевого демо-деплоя без отдельного worker.
- Очереди для уведомлений менеджерам и расчета embeddings документов.
- Скелет eval-регрессии и sales playbook, с которого можно начинать наполнение.
