# infra/scripts/

| Script | What it does |
|---|---|
| `run-all.sh` | Brings the stack up with Podman: network, datastores, seeds, image builds, services, then one analytics job. Safe to re-run. |
| `smoke-test.sh` | Full user journey against a running stack (register, login, catalog, book, worker log, review, job, dashboard snapshot). |

```bash
bash infra/scripts/run-all.sh      # from the repo root
bash infra/scripts/smoke-test.sh
```

Each service `Containerfile` lives under `services/<name>/` (frontend under `frontend/`).

Issues found while containerizing, and the fixes: [NOTES.md](NOTES.md).
