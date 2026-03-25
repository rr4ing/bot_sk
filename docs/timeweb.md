# Развертывание на Timeweb

## Рекомендуемая схема

- `api`: App Platform backend service из `apps/api`
- `admin`: App Platform frontend service из `apps/admin`
- `worker`: App Platform backend worker из `apps/worker`
- `postgres`: Managed PostgreSQL
- `redis`: Managed Redis
- `s3`: Object Storage для вложений и экспортов

## Обязательные переменные окружения

- `DATABASE_URL`
- `DIRECT_URL`
- `REDIS_URL`
- `QUEUE_MODE`
- `AI_PROVIDER=auto|openai|xai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5-mini`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- `XAI_API_KEY`
- `XAI_MODEL=grok-4-1-fast`
- `XAI_BASE_URL=https://api.x.ai/v1`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_MANAGER_CHAT_ID`
- `TELEGRAM_TRANSPORT`
- `ADMIN_API_URL`
- `APP_PUBLIC_URL`
- `ADMIN_PUBLIC_URL`

## Настройка webhook

Если у тебя пока только IP без домена и TLS, используй `TELEGRAM_TRANSPORT=polling`. Тогда webhook не нужен, и API сам забирает апдейты через `getUpdates`.

Если хочешь переключить чат-бота на `Grok`, достаточно выставить:

```bash
AI_PROVIDER=xai
XAI_API_KEY=<your_xai_key>
XAI_MODEL=grok-4-1-fast
```

Embeddings документов при этом могут остаться на `OPENAI_API_KEY`, либо уйдут в локальный fallback для демо-режима.

После деплоя нужно вызвать:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://<api-domain>/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

## Наблюдаемость для старта

- Проверка `GET /health`
- Проверка `GET /ready`
- Логирование webhook latency
- Размер очередей `manager-notifications` и `knowledge-embeddings`
