# Backend webhook

The backend is a Node.js 20 + TypeScript Express service designed for Google Cloud Run.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
npm start
```

Endpoints:

- `GET /health`
- `POST /webhook` — the email-webhook.com receiver
- `POST /test-location` — local/testing input; open without a token only when `NODE_ENV` is not `production`

The service uses the GitHub Contents API when `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPOSITORY` are set. Without them, it writes atomically to `DATA_FILE_PATH` for local development.

See the repository [README](../README.md) for full configuration, curl examples, Cloud Run deployment, Gmail forwarding, and GitHub Pages setup.
