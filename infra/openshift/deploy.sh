#!/usr/bin/env bash
# EventHub — Phase 4 deploy onto ROSA / OpenShift.
# Run from the repo root inside the OpenShift web terminal:
#   oc project passantshaaban-dev
#   bash infra/openshift/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT="$(oc project -q)"
echo "==> Project: $PROJECT"

DNS_RESOLVER="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)"
echo "==> Cluster DNS (for frontend nginx): $DNS_RESOLVER"

# Same passwords as local run-all.sh, except RabbitMQ (guest is loopback-only)
# and DB app users (Red Hat images require a dedicated user, not root/postgres).
PGUSER=eventhub
PGPASSWORD=password
PGDATABASE=auth_db
MYSQL_USER=catalog
MYSQL_PASSWORD=password
MYSQL_DATABASE=eventhub_catalog
MYSQL_ROOT_PASSWORD=password
MONGO_USER=eventhub
MONGO_PASSWORD=password
MONGO_DB=eventhub_bookings
REDIS_PASSWORD=password
RABBITMQ_USER=eventhub
RABBITMQ_PASS=eventhub
RABBITMQ_QUEUE=bookings
JWT_SECRET=dev-secret-key
SNAPSHOT_KEY=analytics:snapshot

wait_deploy() {
  local name=$1
  echo "⏳ Waiting for $name..."
  oc rollout status "deploy/$name" --timeout=300s
}

create_binary_build() {
  local name=$1
  if oc get bc "$name" >/dev/null 2>&1; then
    echo "    BuildConfig $name already exists"
    return
  fi
  oc new-build --name="$name" --binary --strategy=docker --to="$name:latest"
  oc patch bc/"$name" --type=merge \
    -p '{"spec":{"strategy":{"dockerStrategy":{"dockerfilePath":"Containerfile"}}}}'
}

start_build() {
  local name=$1 dir=$2
  echo "==> Building $name from $dir"
  oc start-build "$name" --from-dir="$dir" --follow --wait
}

############################################
echo ""
echo "======== 1. Quota (sanity) ========"
oc describe quota || true
oc describe limitrange || true

############################################
echo ""
echo "======== 2. ImageStreams + BuildConfigs ========"
create_binary_build auth-service
create_binary_build legacy-catalog
create_binary_build booking-service
create_binary_build ai-insight
create_binary_build notification-worker
create_binary_build analytics
create_binary_build frontend
create_binary_build mongo
create_binary_build rabbitmq

# Java + frontend builds need more RAM than the default
oc patch bc/legacy-catalog --type=merge \
  -p '{"spec":{"resources":{"limits":{"memory":"2Gi","cpu":"1"},"requests":{"memory":"512Mi"}}}}' || true
oc patch bc/frontend --type=merge \
  -p '{"spec":{"resources":{"limits":{"memory":"1Gi"},"requests":{"memory":"512Mi"}}}}' || true

oc set image-lookup --all >/dev/null 2>&1 || true

############################################
echo ""
echo "======== 3. Build application + infra images ========"
# Sequential: parallel builds often blow the project quota.
start_build mongo               infra/openshift/mongo
start_build rabbitmq            infra/openshift/rabbitmq
start_build auth-service        services/auth-service-node
start_build legacy-catalog      services/legacy-catalog-java
start_build booking-service     services/booking-service-python
start_build ai-insight          services/ai-insight-service-python
start_build notification-worker services/notification-worker-go
start_build analytics           services/analytics-service-python
start_build frontend            frontend

############################################
echo ""
echo "======== 4. Databases / broker ========"

if ! oc get deploy postgres >/dev/null 2>&1; then
  if oc get template postgresql-ephemeral -n openshift >/dev/null 2>&1; then
    oc new-app --template=postgresql-ephemeral \
      -p DATABASE_SERVICE_NAME=postgres \
      -p POSTGRESQL_USER="$PGUSER" \
      -p POSTGRESQL_PASSWORD="$PGPASSWORD" \
      -p POSTGRESQL_DATABASE="$PGDATABASE"
  else
    oc new-app registry.redhat.io/rhel9/postgresql-16:latest --name=postgres \
      -e POSTGRESQL_USER="$PGUSER" \
      -e POSTGRESQL_PASSWORD="$PGPASSWORD" \
      -e POSTGRESQL_DATABASE="$PGDATABASE"
  fi
fi

if ! oc get deploy mysql >/dev/null 2>&1 && ! oc get dc mysql >/dev/null 2>&1; then
  if oc get template mysql-ephemeral -n openshift >/dev/null 2>&1; then
    oc new-app --template=mysql-ephemeral \
      -p DATABASE_SERVICE_NAME=mysql \
      -p MYSQL_USER="$MYSQL_USER" \
      -p MYSQL_PASSWORD="$MYSQL_PASSWORD" \
      -p MYSQL_DATABASE="$MYSQL_DATABASE" \
      -p MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD"
  else
    oc new-app registry.redhat.io/rhel8/mysql-80:latest --name=mysql \
      -e MYSQL_USER="$MYSQL_USER" \
      -e MYSQL_PASSWORD="$MYSQL_PASSWORD" \
      -e MYSQL_DATABASE="$MYSQL_DATABASE" \
      -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD"
  fi
fi

if ! oc get deploy redis >/dev/null 2>&1; then
  if oc get template redis-ephemeral -n openshift >/dev/null 2>&1; then
    oc new-app --template=redis-ephemeral \
      -p DATABASE_SERVICE_NAME=redis \
      -p REDIS_PASSWORD="$REDIS_PASSWORD"
  else
    oc new-app registry.redhat.io/rhel9/redis-7:latest --name=redis \
      -e REDIS_PASSWORD="$REDIS_PASSWORD"
  fi
fi

if ! oc get deploy mongo >/dev/null 2>&1; then
  oc new-app mongo:latest --name=mongo
fi

if ! oc get deploy rabbitmq >/dev/null 2>&1; then
  oc new-app rabbitmq:latest --name=rabbitmq \
    -e RABBITMQ_DEFAULT_USER="$RABBITMQ_USER" \
    -e RABBITMQ_DEFAULT_PASS="$RABBITMQ_PASS"
fi

# Templates sometimes name the DeploymentConfig/Deployment after the image, not
# the service. Wait on whatever owns the Service.
for svc in postgres mysql mongo redis rabbitmq; do
  echo "⏳ Waiting for service $svc endpoints..."
  oc wait --for=jsonpath='{.subsets[0].addresses[0].ip}' "endpoints/$svc" --timeout=300s
done

############################################
echo ""
echo "======== 5. Seed MySQL + MongoDB ========"
# Find a ready pod backing each service
mysql_pod="$(oc get pod -l deployment=mysql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [ -z "$mysql_pod" ]; then
  mysql_pod="$(oc get pod -l name=mysql -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
fi
if [ -z "$mysql_pod" ]; then
  mysql_pod="$(oc get pod --field-selector=status.phase=Running -o name | grep mysql | head -1 | cut -d/ -f2)"
fi

echo "    MySQL pod: $mysql_pod"
oc exec -i "$mysql_pod" -- mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  < "$ROOT/db-seed/mysql-seed.sql"

mongo_pod="$(oc get pod --field-selector=status.phase=Running -o name | grep mongo | grep -v build | head -1 | cut -d/ -f2)"
echo "    Mongo pod: $mongo_pod"
oc cp "$ROOT/db-seed/mongo-seed.js" "$mongo_pod:/tmp/mongo-seed.js"
oc exec "$mongo_pod" -- mongosh --quiet "$MONGO_DB" /tmp/mongo-seed.js

echo "    Catalog rows:"
oc exec "$mysql_pod" -- mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -N -e \
  "SELECT COUNT(*) FROM $MYSQL_DATABASE.catalog_event;"

############################################
echo ""
echo "======== 6. Application services ========"

deploy_app() {
  local name=$1
  shift
  if oc get deploy "$name" >/dev/null 2>&1; then
    echo "    deploy/$name already exists — updating env"
    oc set env deploy/"$name" "$@"
    return
  fi
  oc new-app "$name:latest" --name="$name"
  oc set env deploy/"$name" "$@"
}

deploy_app auth-service \
  PORT=8082 \
  PGHOST=postgres PGPORT=5432 \
  PGUSER="$PGUSER" PGPASSWORD="$PGPASSWORD" PGDATABASE="$PGDATABASE" \
  JWT_SECRET="$JWT_SECRET"

deploy_app legacy-catalog \
  SPRING_DATASOURCE_URL="jdbc:mysql://mysql:3306/${MYSQL_DATABASE}?allowPublicKeyRetrieval=true&useSSL=false" \
  SPRING_DATASOURCE_USERNAME="$MYSQL_USER" \
  SPRING_DATASOURCE_PASSWORD="$MYSQL_PASSWORD" \
  JAVA_TOOL_OPTIONS="-Xms64m -Xmx256m"

deploy_app ai-insight \
  PORT=8084

deploy_app booking-service \
  PORT=8083 \
  MONGO_URI="mongodb://mongo:27017" \
  MONGO_DB="$MONGO_DB" \
  RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@rabbitmq:5672/" \
  RABBITMQ_QUEUE="$RABBITMQ_QUEUE" \
  AI_INSIGHT_URL="http://ai-insight:8084"

if ! oc get deploy notification-worker >/dev/null 2>&1; then
  oc new-app notification-worker:latest --name=notification-worker
fi
oc set env deploy/notification-worker \
  RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@rabbitmq:5672/" \
  RABBITMQ_QUEUE="$RABBITMQ_QUEUE"

# ImageStream is named "analytics"; the running API Deployment is analytics-api
if ! oc get deploy analytics-api >/dev/null 2>&1; then
  oc new-app analytics:latest --name=analytics-api
fi
oc set env deploy/analytics-api \
  PORT=8085 \
  REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379/0" \
  BOOKING_SERVICE_URL="http://booking-service:8083" \
  CATALOG_SERVICE_URL="http://legacy-catalog:8081" \
  SNAPSHOT_KEY="$SNAPSHOT_KEY"

if ! oc get deploy frontend >/dev/null 2>&1; then
  oc new-app frontend:latest --name=frontend
fi
oc set env deploy/frontend "DNS_RESOLVER=$DNS_RESOLVER"

# Probes — CRI-O ignores Dockerfile HEALTHCHECK
oc set probe deploy/auth-service        --readiness --liveness --get-url=http://:8082/health --initial-delay-seconds=15 || true
oc set probe deploy/legacy-catalog      --readiness --liveness --get-url=http://:8081/api/catalog --initial-delay-seconds=40 || true
oc set probe deploy/ai-insight          --readiness --liveness --get-url=http://:8084/health --initial-delay-seconds=15 || true
oc set probe deploy/booking-service     --readiness --liveness --get-url=http://:8083/health --initial-delay-seconds=15 || true
oc set probe deploy/analytics-api       --readiness --liveness --get-url=http://:8085/health --initial-delay-seconds=15 || true
oc set probe deploy/frontend            --readiness --liveness --get-url=http://:8080/ --initial-delay-seconds=5 || true

oc set resources deploy/legacy-catalog --requests=memory=256Mi --limits=memory=512Mi || true
oc set resources deploy/frontend --requests=memory=64Mi --limits=memory=128Mi || true

for d in auth-service legacy-catalog ai-insight booking-service analytics-api frontend notification-worker; do
  wait_deploy "$d"
done

############################################
echo ""
echo "======== 7. Analytics Job (once, then exits) ========"
ANALYTICS_IMAGE="image-registry.openshift-image-registry.svc:5000/${PROJECT}/analytics:latest"
oc delete job analytics-job --ignore-not-found
oc run analytics-job --image="$ANALYTICS_IMAGE" --restart=OnFailure \
  --env="REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0" \
  --env="BOOKING_SERVICE_URL=http://booking-service:8083" \
  --env="CATALOG_SERVICE_URL=http://legacy-catalog:8081" \
  --env="SNAPSHOT_KEY=${SNAPSHOT_KEY}" \
  --command -- python job.py
oc wait --for=condition=complete job/analytics-job --timeout=180s
oc logs job/analytics-job

############################################
echo ""
echo "======== 8. Public Route (frontend only) ========"
oc delete route frontend --ignore-not-found
oc create route edge frontend --service=frontend --port=8080 --insecure-policy=Redirect
# If the service port is named http/8080-tcp, the flag above still works.

HOST="$(oc get route frontend -o jsonpath='{.spec.host}')"
echo ""
echo "🎉 Public URL:  https://$HOST"
echo "    Submit that URL once the checks below pass."
echo ""
echo "======== 9. Smoke checks ========"
echo "Catalog:"
curl -sf "https://$HOST/api/catalog" || curl -sf "http://$HOST/api/catalog" || true
echo
echo "Analytics:"
curl -sf "https://$HOST/api/analytics/summary" || true
echo
echo "Pods:"
oc get pods
echo
echo "Route:"
oc get route frontend
