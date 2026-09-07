# Frontend (React + Vite)

## Native dev

```bash
cp .env.example .env
npm install
npm run dev
```

The SPA uses `window.__ENV__.API_BASE_URL` from `public/config.js` (empty string in production so requests stay same-origin through Nginx). `VITE_API_BASE_URL` is the Vite-dev fallback.

## Container

Multi-stage `Containerfile`: Node build, then Nginx on **8080** with `/api/*` proxy rules. Map host 3000 → 8080 (Compose already does this).
