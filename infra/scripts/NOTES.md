# Phase 2 — Issues Faced & How They Were Solved

## 1. Podman short-name registry error

**Issue**: `podman build` failed with:
> short-name "maven:3.9-eclipse-temurin-8" did not resolve to an alias and no unqualified-search registries are defined

**Cause**: Unlike Docker, Podman does not default to `docker.io` as an unqualified search registry.

**Fix**: Added `docker.io` to `/etc/containers/registries.conf`:
```toml
unqualified-search-registries = ["docker.io"]
```

---

## 2. MySQL 8 authentication — legacy-catalog crashes on startup

**Issue**: `legacy-catalog` (Spring Boot / Java) crashed immediately with:
> Public Key Retrieval is not allowed

**Cause**: MySQL 8 uses `caching_sha2_password` by default, which requires SSL or explicit public key retrieval when connecting from a JDBC driver without SSL.

**Fix**: Appended connection parameters to the JDBC URL env var:
```
SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/eventhub_catalog?allowPublicKeyRetrieval=true&useSSL=false
```

---

## 3. MySQL port open ≠ MySQL ready

**Issue**: `legacy-catalog` crashed even after `wait_for_port mysql 3306` passed, because MySQL opens the TCP port before finishing internal initialization.

**Fix**: Added a second check using `podman exec mysql mysql -e "SELECT 1;"` that polls until MySQL actually accepts queries, not just when the port is open.

---

## 4. Nginx fails to start when upstream containers aren't running

**Issue**: The frontend Nginx container exited immediately if any upstream service (e.g., `legacy-catalog`) wasn't yet running, because Nginx resolves all `proxy_pass` hostnames at startup.

**Fix**: Used Nginx's `set $upstream` variable pattern with an explicit `resolver` directive. This defers DNS resolution to request time (lazy), so Nginx starts successfully even if upstreams are not yet available:
```nginx
resolver 10.89.0.1 valid=10s;
location /api/catalog {
    set $upstream http://legacy-catalog:8081;
    proxy_pass $upstream;
}
```

**Podman-specific**: The correct DNS resolver IP is `10.89.0.1` (Podman's Netavark DNS), confirmed from `/etc/resolv.conf` inside the container. Docker uses `127.0.0.11` — these are not interchangeable.

---

## 5. Analytics dashboard showed empty data

**Issue**: After `run-all.sh` completed, the dashboard showed no events and flat charts despite the analytics job running successfully.

**Cause (a)**: `snapshot.py` only built the events table from events that *had bookings*. Since MongoDB started empty, there were no bookings, so the table was empty.

**Fix**: Modified `snapshot.py` to iterate over all catalog events and use `per_event.get(event_id, zero_stats)`, so all events appear in the table regardless of whether they have bookings.

**Cause (b)**: MongoDB was not seeded in `run-all.sh`. The bookings timeseries was flat because there was genuinely no data.

**Fix**: Added a MongoDB seed step to `run-all.sh` using `podman cp` + `podman exec mongo mongosh`, inserting bookings spread across 7 days and reviews with varied sentiment scores.

---

## 6. Analytics job connection error (services not ready)

**Issue**: The analytics job ran immediately after `podman run -d` for the services, but the services hadn't finished initializing yet, causing connection refused errors.

**Fix**: Added `wait_for_port` calls for `legacy-catalog`, `booking-service`, and `analytics-api` between the service start commands and the analytics job invocation.

---

## 7. Frontend context path error

**Issue**: Running `podman build -t frontend:local frontend/` from inside the `frontend/` directory caused:
> Error: context must be a directory: ".../frontend/frontend"

**Cause**: The context path `frontend/` was appended to the current working directory, which was already `frontend/`.

**Fix**: Either run the build from the project root, or use `.` as the context when already inside `frontend/`.

---

## 8. MySQL seed silently did nothing — empty catalog, empty dashboard

**Issue**: The catalog page rendered zero events and the dashboard's events
table and sentiment pie chart were both empty, even though `run-all.sh` ran
top to bottom without a single error and every container reported healthy.
`GET /api/catalog` returned `[]`, and `SELECT * FROM catalog_event` returned no
rows — but the table itself existed.

**Cause**: The seed step was

```bash
podman exec mysql sh -c 'mysql -uroot -ppassword eventhub_catalog < /dev/stdin' \
  < db-seed/mysql-seed.sql
```

Without `-i`, `podman exec` does not attach the caller's stdin to the
container, so the process inside sees `/dev/null`. The redirect fed `mysql` an
empty script, which is a perfectly valid thing to do, so it exited 0 and
`set -e` had nothing to catch. The `catalog_event` table existed only because
Hibernate's `ddl-auto=update` created it when the catalog service started.

This one bug explained all three missing pieces at once: the analytics
snapshot builds its events table by iterating over the catalog, and it
attributes review sentiment per catalog event, so an empty catalog yields an
empty `eventsTable` and all-zero `sentimentTotals`. The bookings-over-time
chart still had data, which is why only two of the three dashboard widgets
looked broken.

**Fix**: Attach stdin and drop the pointless `sh -c` wrapper:

```bash
podman exec -i mysql mysql -uroot -ppassword eventhub_catalog \
  < db-seed/mysql-seed.sql
```

Also added a verification step after seeding that counts the rows and aborts
with a clear message if the catalog is empty. A seed that quietly does nothing
is the worst failure mode here — everything downstream looks healthy and only
the UI is wrong.

---

## 9. Re-running the script stacked duplicate seed data

**Issue**: The bookings-over-time chart showed exactly 5 bookings on every
single day. MongoDB held 35 bookings and 25 reviews instead of 7 and 5.

**Cause**: Named volumes survive `podman rm -f`, so the data outlives the
containers, but `mongo-seed.js` did an unconditional `insertMany`. Every
`run-all.sh` run appended another full copy of the seed — five runs, five
copies.

**Fix**: `mongo-seed.js` now deletes its own documents by their seed ids
before inserting, so it converges on the same 7 bookings and 5 reviews no
matter how many times it runs. Bookings and reviews created through the API
are matched by id and left alone.

`mysql-seed.sql` had the same latent problem: `INSERT` with auto-increment ids
would have both duplicated the events and renumbered them on a re-run, which
would have broken the MongoDB seed's `eventId` references. It now uses
explicit ids 1-4 with `ON DUPLICATE KEY UPDATE`.

---

## 10. None of the health checks were actually active

**Issue**: Every Containerfile declares a `HEALTHCHECK`, but `podman ps`
showed a bare `Up 2 minutes` for all containers — no health status at all.

**Cause**: Podman builds OCI-format images by default, and the OCI image spec
has no health check field, so the instruction is discarded at build time. The
only sign is a warning that scrolls past in the build output:

> HEALTHCHECK is not supported for OCI image format and will be ignored. Must
> use `docker` format

**Fix**: Build with `--format=docker`. `podman ps` now reports
`(healthy)` for all seven service containers.

The five infrastructure containers had no health check either — the official
`postgres`, `mysql`, `mongo`, `redis` and `rabbitmq` images ship without one.
They now get an explicit `--health-cmd` on `podman run` (`pg_isready`,
`mysqladmin ping`, `db.adminCommand({ping:1})`, `redis-cli ping`,
`rabbitmq-diagnostics ping`).

Note this is separate from the readiness polling in `wait_for_port`: the
health checks report ongoing liveness, while the polling is what gates
start-up ordering.

---

## 11. Frontend proxied every `/api/` path except `/api/analyze`

**Issue**: `nginx.conf` had proxy rules for catalog, auth, bookings and
analytics, but not for the AI Insight service. A request to `/api/analyze`
fell through to the SPA fallback and returned `index.html`, so the frontend
would have failed parsing HTML as JSON rather than getting a clear error.

**Fix**: Added the missing `location /api/analyze` block pointing at
`ai-insight:8084`, and the matching entry in the Vite dev proxy.

---

## 12. `OLLAMA_URL` pointed at the container's own localhost

**Issue**: The AI Insight container was started with
`OLLAMA_URL=http://localhost:11434`. Inside a container, `localhost` is that
container, so Ollama was unreachable by construction and every review silently
took the rule-based fallback path.

**Fix**: Point at the host gateway instead
(`--add-host host.containers.internal:host-gateway` plus
`OLLAMA_URL=http://host.containers.internal:11434`), overridable by exporting
`OLLAMA_URL` before running the script. The fallback still applies when Ollama
isn't running, which is a supported mode — but now it's a fallback rather than
the only possible outcome.

---

## Why the analytics job container has no health check

The spec explicitly states the analytics job container does not need a health check. The reason is that it is a **short-lived batch job** — it runs once, does its work, and exits with code 0 on success. Health checks are only meaningful for long-running services that could become unhealthy while running. For a container that is expected to exit, a health check would either never fire (exits too fast) or give a false failure signal. This distinction becomes important in Phase 4 when schedulers need to differentiate between "service" and "job" workloads.
