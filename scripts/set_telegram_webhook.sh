#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "TELEGRAM_BOT_TOKEN is required"
  exit 1
fi

if [[ -z "${APP_PUBLIC_URL:-}" ]]; then
  echo "APP_PUBLIC_URL is required"
  exit 1
fi

curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d "{
    \"url\": \"${APP_PUBLIC_URL}/webhooks/telegram\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET:-}\"
  }"
