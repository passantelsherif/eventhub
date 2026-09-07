#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── Helper: poll a TCP port until it accepts connections ───────────────────────
wait_for_port() {
  local host=$1 port=$2 label=$3
  echo "⏳ Waiting for $label ($host:$port)..."
  until podman run --rm --network eventhub-net alpine \
    sh -c "nc -z $host $port" 2>/dev/null; do
    sleep 1
  done
  echo "✅ $label port is open."
}

# ── Helper: wait until MySQL actually accepts queries ──────────────────────────
wait_for_mysql() {
  echo "⏳ Waiting for MySQL to accept queries..."
  until podman exec mysql mysql -uroot -ppassword -e "SELECT 1;" 2>/dev/null; do
    sleep 2
  done
  echo "✅ MySQL is ready."
}

# ── 1. Teardown any previous run (makes the script safe to re-run) ────────────
echo "==> Cleaning up previous run..."
podman rm -f \
  postgres mysql mongo redis rabbitmq \
  auth-service legacy-catalog ai-insight booking-service \
  notification-worker analytics-api frontend \
  2>/dev/null || true
podman network rm eventhub-net 2>/dev/null || true

# ── 2. Network ─────────────────────────────────────────────────────────────────
echo "==> Creating network..."
podman network create eventhub-net

# ── 2. Infrastructure containers ───────────────────────────────────────────────
echo "==> Starting infrastructure..."

# The official database images ship no HEALTHCHECK of their own, so each one
# gets an explicit --health-cmd here. The service images carry theirs in their
# Containerfile instead.
podman run -d --name postgres --network eventhub-net \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=auth_db \
  -v pg-data:/var/lib/postgresql/data \
  --health-cmd "pg_isready -U postgres -d auth_db" \
  --health-interval 10s --health-retries 5 --health-start-period 10s \
  postgres:16-alpine

podman run -d --name mysql --network eventhub-net \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=eventhub_catalog \
  -v mysql-data:/var/lib/mysql \
  --health-cmd "mysqladmin ping -uroot -ppassword --silent" \
  --health-interval 10s --health-retries 10 --health-start-period 30s \
  mysql:8

podman run -d --name mongo --network eventhub-net \
  -v mongo-data:/data/db \
  --health-cmd "mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'" \
  --health-interval 10s --health-retries 5 --health-start-period 15s \
  mongo:7

podman run -d --name redis --network eventhub-net \
  -v redis-data:/data \
  --health-cmd "redis-cli ping" \
  --health-interval 10s --health-retries 5 --health-start-period 5s \
  redis:7-alpine

podman run -d --name rabbitmq --network eventhub-net \
  -e RABBITMQ_DEFAULT_USER=guest \
  -e RABBITMQ_DEFAULT_PASS=guest \
  -v rabbitmq-data:/var/lib/rabbitmq \
  --health-cmd "rabbitmq-diagnostics -q ping" \
  --health-interval 15s --health-retries 5 --health-start-period 30s \
  rabbitmq:3-alpine

# ── 3. Wait for infra ──────────────────────────────────────────────────────────
echo "==> Waiting for dependencies..."
wait_for_port postgres  5432  "PostgreSQL"
wait_for_port mongo     27017 "MongoDB"
wait_for_port redis     6379  "Redis"
wait_for_port rabbitmq  5672  "RabbitMQ"

# MySQL needs two checks: port open + actually accepting queries
wait_for_port mysql 3306 "MySQL"
wait_for_mysql

# ── 4. Seed databases ──────────────────────────────────────────────────────────
# `podman exec` needs -i, otherwise the container's stdin is /dev/null and the
# redirect below feeds mysql an empty script that exits 0 without seeding.
echo "==> Seeding MySQL..."
podman exec -i mysql mysql -uroot -ppassword eventhub_catalog \
  < "$PROJECT_ROOT/db-seed/mysql-seed.sql"

echo "==> Seeding MongoDB..."
podman cp "$PROJECT_ROOT/db-seed/mongo-seed.js" mongo:/tmp/mongo-seed.js
podman exec mongo mongosh --quiet eventhub_bookings /tmp/mongo-seed.js

# ── 4b. Verify the seeds actually landed ───────────────────────────────────────
# A seed that silently does nothing is the hardest failure to spot: every
# service comes up healthy and the dashboard is just empty.
echo "==> Verifying seed data..."
catalog_rows=$(podman exec mysql mysql -uroot -ppassword -N -B \
  -e "SELECT COUNT(*) FROM eventhub_catalog.catalog_event;" 2>/dev/null)
if [ "${catalog_rows:-0}" -lt 1 ]; then
  echo "❌ MySQL seed left catalog_event empty — the catalog page and the"
  echo "   dashboard events table would both render blank. Aborting."
  exit 1
fi
echo "✅ MySQL: $catalog_rows catalog events."

booking_rows=$(podman exec mongo mongosh --quiet eventhub_bookings \
  --eval 'db.bookings.countDocuments({})')
echo "✅ MongoDB: $booking_rows bookings."

# ── 5. Build service images ────────────────────────────────────────────────────
# --format=docker is required: podman defaults to the OCI image format, which
# has no HEALTHCHECK field, so every Containerfile's health check is discarded
# at build time with only a warning.
echo "==> Building images..."
BUILD_OPTS=(-q --format=docker)
podman build "${BUILD_OPTS[@]}" -t auth-service:local        "$PROJECT_ROOT/services/auth-service-node"
podman build "${BUILD_OPTS[@]}" -t legacy-catalog:local      "$PROJECT_ROOT/services/legacy-catalog-java"
podman build "${BUILD_OPTS[@]}" -t ai-insight:local          "$PROJECT_ROOT/services/ai-insight-service-python"
podman build "${BUILD_OPTS[@]}" -t booking-service:local     "$PROJECT_ROOT/services/booking-service-python"
podman build "${BUILD_OPTS[@]}" -t notification-worker:local "$PROJECT_ROOT/services/notification-worker-go"
podman build "${BUILD_OPTS[@]}" -t analytics-api:local       "$PROJECT_ROOT/services/analytics-service-python"
podman build "${BUILD_OPTS[@]}" -t frontend:local            "$PROJECT_ROOT/frontend"

# ── 6. Run services ────────────────────────────────────────────────────────────
echo "==> Starting services..."

podman run -d --name auth-service --network eventhub-net -p 8082:8082 \
  -e PORT=8082 \
  -e PGHOST=postgres \
  -e PGPORT=5432 \
  -e PGUSER=postgres \
  -e PGPASSWORD=password \
  -e PGDATABASE=auth_db \
  -e JWT_SECRET=dev-secret-key \
  auth-service:local

# Note: JDBC URL includes allowPublicKeyRetrieval fix for MySQL 8 compatibility
podman run -d --name legacy-catalog --network eventhub-net -p 8081:8081 \
  -e SPRING_DATASOURCE_URL="jdbc:mysql://mysql:3306/eventhub_catalog?allowPublicKeyRetrieval=true&useSSL=false" \
  -e SPRING_DATASOURCE_USERNAME=root \
  -e SPRING_DATASOURCE_PASSWORD=password \
  legacy-catalog:local

# localhost inside this container is the container itself, so Ollama has to be
# addressed through the host gateway. If Ollama isn't running there the service
# falls back to its rule-based analysis, which is a supported mode.
podman run -d --name ai-insight --network eventhub-net -p 8084:8084 \
  --add-host host.containers.internal:host-gateway \
  -e PORT=8084 \
  -e OLLAMA_URL="${OLLAMA_URL:-http://host.containers.internal:11434}" \
  -e OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:1b}" \
  ai-insight:local

podman run -d --name booking-service --network eventhub-net -p 8083:8083 \
  -e PORT=8083 \
  -e MONGO_URI=mongodb://mongo:27017 \
  -e MONGO_DB=eventhub_bookings \
  -e RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/ \
  -e RABBITMQ_QUEUE=bookings \
  -e AI_INSIGHT_URL=http://ai-insight:8084 \
  booking-service:local

podman run -d --name notification-worker --network eventhub-net \
  -e RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/ \
  -e RABBITMQ_QUEUE=bookings \
  notification-worker:local

podman run -d --name analytics-api --network eventhub-net -p 8085:8085 \
  -e PORT=8085 \
  -e REDIS_URL=redis://redis:6379/0 \
  -e BOOKING_SERVICE_URL=http://booking-service:8083 \
  -e CATALOG_SERVICE_URL=http://legacy-catalog:8081 \
  -e SNAPSHOT_KEY=analytics:snapshot \
  analytics-api:local

# DNS_RESOLVER is the eventhub-net gateway, where podman's aardvark-dns
# listens. nginx needs it to resolve the upstream service names at request
# time. Under docker compose this value is 127.0.0.11 instead.
podman run -d --name frontend --network eventhub-net -p 3000:8080 \
  -e DNS_RESOLVER=10.89.0.1 \
  frontend:local

# ── Wait for services to be ready before running the analytics job ─────────────
# Services were just started — they need time to fully initialize
echo "==> Waiting for services to be ready..."
wait_for_port legacy-catalog  8081 "Legacy Catalog"
wait_for_port booking-service 8083 "Booking Service"
wait_for_port analytics-api   8085 "Analytics API"

# ── 7. Run analytics job once ──────────────────────────────────────────────────
echo "==> Running analytics job..."
podman run --rm --network eventhub-net \
  -e REDIS_URL=redis://redis:6379/0 \
  -e BOOKING_SERVICE_URL=http://booking-service:8083 \
  -e CATALOG_SERVICE_URL=http://legacy-catalog:8081 \
  -e SNAPSHOT_KEY=analytics:snapshot \
  analytics-api:local \
  python job.py

echo ""
echo "🎉 All done! Open http://localhost:3000"
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"