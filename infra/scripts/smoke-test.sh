#!/usr/bin/env bash
# Walks the full user journey against the running stack and prints what each
# step returned: register -> login -> catalog -> book -> notification worker
# log -> review with sentiment -> analytics job -> dashboard snapshot.
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
EMAIL="smoke-$(date +%s)@example.com"

echo "==> Register ($EMAIL)"
curl -sf -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pass123\"}"
echo

echo "==> Login"
TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pass123\"}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "token: ${TOKEN:0:24}..."

echo "==> Catalog"
curl -sf "$BASE/api/catalog"
echo

echo "==> Book event 2"
BOOKING_ID=$(curl -sf -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"userId":"smoke-user","eventId":2}' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
echo "bookingId: $BOOKING_ID"

echo "==> Notification worker log (async consumer)"
sleep 2
podman logs --tail 3 notification-worker

echo "==> Review (synchronous AI sentiment)"
curl -sf -X POST "$BASE/api/bookings/$BOOKING_ID/review" -H 'Content-Type: application/json' \
  -d '{"text":"Absolutely fantastic, best event of the semester!"}'
echo

echo "==> Re-run analytics job"
podman run --rm --network eventhub-net \
  -e REDIS_URL=redis://redis:6379/0 \
  -e BOOKING_SERVICE_URL=http://booking-service:8083 \
  -e CATALOG_SERVICE_URL=http://legacy-catalog:8081 \
  -e SNAPSHOT_KEY=analytics:snapshot \
  analytics-api:local python job.py

echo "==> Dashboard snapshot"
curl -sf "$BASE/api/analytics/summary"
echo
echo "✅ Full journey passed."
