# OpenShift

Deploy EventHub onto an OpenShift project (for example ROSA). The public URL is the **frontend Route** only.

## Objects

| Local | Cluster |
|---|---|
| `podman build` | Binary **BuildConfig** from each `Containerfile` |
| `podman run -d` | **Deployment** (or template **DeploymentConfig** for some databases) |
| Container DNS name | **Service** — keep names `postgres`, `mysql`, `mongo`, `redis`, `rabbitmq`, `legacy-catalog`, `auth-service`, `booking-service`, `ai-insight`, `analytics-api`, `frontend` |
| `python job.py` | **Job** or **CronJob** (do not run this as a Deployment) |
| `-p 3000:8080` | **Route** on `frontend`, port 8080 |

## Notes that bite

- Restricted SCC: non-root UID, no bind on port 80. Frontend nginx listens on **8080**.
- `mongo/` and `rabbitmq/` here are thin images with group-writable data dirs.
- CRI-O ignores Dockerfile `HEALTHCHECK`. Set probes on the Deployment.
- Nginx `resolver` + `set $upstream http://legacy-catalog:8081` does **not** use Kubernetes search domains. Use `<service>.<namespace>.svc.cluster.local`.
- Each `oc set env` / `oc set probe` creates a new ReplicaSet. Idle ReplicaSets still count toward quota.
- Clusters often scale replicas to 0 when idle. Use `oc scale --replicas=1`, not only `rollout restart`. Ephemeral databases need re-seeding.
- `deploy.sh` in this folder is a starting point; adjust image names and env for your project.

Ollama is optional on the cluster. AI Insight’s fallback still returns sentiment.
