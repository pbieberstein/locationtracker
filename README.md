# Satellite Hike Location Tracker MVP

This repository implements the complete experimental pipeline:

```text
iPhone SMS / satellite message
  → Google Voice
  → Gmail forwarding rule
  → email-webhook.com
  → Google Cloud Run webhook
  → GitHub data/locations.json
  → GitHub Pages + Leaflet map
```

The backend is replaceable TypeScript modules (`MessageParser`, `LocationParser`, `PhoneHasher`, and `LocationStore`). The frontend is static HTML/CSS/JavaScript with no build step and refreshes its JSON every 60 seconds.

## Project structure

```text
.
├── .github/workflows/pages.yml       # GitHub Pages deployment
├── backend/
│   ├── src/
│   │   ├── parser/location.ts        # GPS formats + Google Maps URLs
│   │   ├── parser/message.ts         # email-webhook/Gmail normalization
│   │   ├── storage/github.ts         # GitHub Contents API + conflict retry
│   │   ├── storage/local.ts          # local JSON development store
│   │   ├── config.ts                 # storage selection
│   │   ├── hashing.ts                # deterministic SHA-256
│   │   ├── phone.ts                  # E.164 phone normalization
│   │   ├── service.ts                # shared processing pipeline
│   │   ├── server.ts                 # HTTP routes
│   │   └── types.ts                  # replaceable contracts/data types
│   ├── tests/                        # parser/API/pipeline/storage tests
│   ├── Dockerfile
│   ├── package.json
│   └── README.md
├── data/locations.json
└── web/
    ├── index.html
    ├── app.js
    ├── styles.css
    └── README.md
```

## 1. Local setup

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/USERNAME/REPOSITORY.git
cd REPOSITORY/backend
npm install
cp .env.example .env
npm run dev
```

No environment variables are required for local JSON mode. From another terminal:

```bash
curl http://localhost:8080/health

curl -X POST http://localhost:8080/test-location \
  -H 'Content-Type: application/json' \
  -d '{
    "phone": "+16045551234",
    "message": "https://maps.google.com/?q=49.2827,-123.1207",
    "timestamp": "2026-08-07T20:15:00Z",
    "messageId": "local-test-1"
  }'
```

The response includes `phoneHash`. Confirm that `data/locations.json` contains that key, then preview the site from the repository root:

```bash
cd ..
python3 -m http.server 3000
```

Open:

```text
http://localhost:3000/web/?phone=PHONE_HASH_FROM_RESPONSE
```

Send a second request with a new `messageId`, timestamp, and coordinate to see another history point. Repeating the identical request returns `"status":"duplicate"` and does not add a point.

Run verification with:

```bash
cd backend
npm test
npm run build
```

## 2. Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `PORT` | Cloud Run supplies it | HTTP port; defaults to `8080` |
| `NODE_ENV` | Recommended | Use `production` on Cloud Run |
| `GITHUB_TOKEN` | Production | Fine-grained PAT with Contents read/write for this repository |
| `GITHUB_OWNER` | Production | GitHub account or organization |
| `GITHUB_REPOSITORY` | Production | Repository name only |
| `GITHUB_BRANCH` | No | Target branch; defaults to `main` |
| `WEBHOOK_SECRET` | Strongly recommended | Expected `X-Webhook-Secret` or bearer token on `/webhook` |
| `TEST_TOKEN` | Production endpoint | Expected `X-Test-Token` or bearer token on `/test-location`; without it the production test route returns 401 |
| `DEFAULT_PHONE_REGION` | No | Region for numbers without a country code; defaults to `CA` |
| `HISTORY_LIMIT` | No | Maximum points per phone hash; defaults to `1000` |
| `DATA_FILE_PATH` | Local only | Local JSON path; defaults to `../data/locations.json` |
| `DIAGNOSTIC_MODE` | No | `off`, `metadata`, or temporary `raw` payload logging |
| `LOG_LEVEL` | Reserved | Present for future filtering; structured logs currently emit info/errors |

Never put `GITHUB_TOKEN`, `WEBHOOK_SECRET`, or `TEST_TOKEN` in `web/`, repository files, curl history, or GitHub Pages settings.

## 3. GitHub configuration

1. Create an empty GitHub repository, then initialize and push this workspace (it is not initialized as a Git repository yet):

   ```bash
   git init -b main
   git add .
   git commit -m 'Build satellite hike tracker MVP'
   git remote add origin https://github.com/USERNAME/REPOSITORY.git
   git push -u origin main
   ```

2. Create a fine-grained Personal Access Token restricted to this repository with **Repository permissions → Contents: Read and write**. The backend uses it only for `data/locations.json`.
3. If branch protection prevents direct Contents API commits, allow the token owner to bypass the relevant rule or use a dedicated unprotected data branch and set `GITHUB_BRANCH` to it. The Pages workflow currently listens to `main`, so update its branch trigger if using another branch.
4. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
5. Run **Actions → Deploy tracker to GitHub Pages → Run workflow** once, or push a web/data change.
6. The canonical tracking URL is `https://USERNAME.github.io/REPOSITORY/?phone=PHONE_HASH`. A deployed `404.html` also supports `https://USERNAME.github.io/REPOSITORY/PHONE_HASH`.

Every successful backend GitHub commit changes `data/locations.json`, which triggers a Pages deployment. Deployment latency is separate from the frontend's 60-second polling interval.

To compute the canonical hash manually:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('+16045551234').digest('hex'))"
```

The frontend also accepts an E.164 value such as `?phone=+16045551234` and hashes it in-browser for testing. Do not share that raw-phone URL.

## 4. Deploy the backend to Google Cloud Run

Install and authenticate the `gcloud` CLI, then replace the uppercase placeholders. These commands use Artifact Registry, Cloud Build, Cloud Run, Secret Manager, and a dedicated runtime service account.

```bash
export HIKE_PROJECT_ID='YOUR_GCP_PROJECT_ID'
export HIKE_REGION='us-west1'
export HIKE_GITHUB_OWNER='YOUR_GITHUB_USERNAME'
export HIKE_GITHUB_REPOSITORY='YOUR_REPOSITORY'

gcloud projects create "$HIKE_PROJECT_ID"
gcloud config set project "$HIKE_PROJECT_ID"
gcloud billing projects link "$HIKE_PROJECT_ID" --billing-account='YOUR_BILLING_ACCOUNT_ID'

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

gcloud artifacts repositories create hike-tracker \
  --repository-format=docker \
  --location="$HIKE_REGION" \
  --description='Hike Tracker containers'

gcloud iam service-accounts create hike-tracker-runtime \
  --display-name='Hike Tracker Cloud Run runtime'
```

Create three secret values without placing them directly in the command line:

```bash
gcloud secrets create hike-github-token --replication-policy=automatic
gcloud secrets create hike-webhook-secret --replication-policy=automatic
gcloud secrets create hike-test-token --replication-policy=automatic

read -s 'HIKE_SECRET_VALUE?GitHub token: '
printf %s "$HIKE_SECRET_VALUE" | gcloud secrets versions add hike-github-token --data-file=-
unset HIKE_SECRET_VALUE

read -s 'HIKE_SECRET_VALUE?Webhook secret: '
printf %s "$HIKE_SECRET_VALUE" | gcloud secrets versions add hike-webhook-secret --data-file=-
unset HIKE_SECRET_VALUE

read -s 'HIKE_SECRET_VALUE?Test endpoint token: '
printf %s "$HIKE_SECRET_VALUE" | gcloud secrets versions add hike-test-token --data-file=-
unset HIKE_SECRET_VALUE
```

Grant only the runtime identity access to read those secrets:

```bash
export HIKE_RUNTIME_SA="hike-tracker-runtime@${HIKE_PROJECT_ID}.iam.gserviceaccount.com"

for HIKE_SECRET_NAME in hike-github-token hike-webhook-secret hike-test-token; do
  gcloud secrets add-iam-policy-binding "$HIKE_SECRET_NAME" \
    --member="serviceAccount:${HIKE_RUNTIME_SA}" \
    --role='roles/secretmanager.secretAccessor'
done
```

From the repository root, build and deploy:

```bash
export HIKE_IMAGE="${HIKE_REGION}-docker.pkg.dev/${HIKE_PROJECT_ID}/hike-tracker/backend:latest"

gcloud builds submit backend --tag "$HIKE_IMAGE"

gcloud run deploy hike-tracker-webhook \
  --image="$HIKE_IMAGE" \
  --region="$HIKE_REGION" \
  --platform=managed \
  --service-account="$HIKE_RUNTIME_SA" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars="NODE_ENV=production,GITHUB_OWNER=${HIKE_GITHUB_OWNER},GITHUB_REPOSITORY=${HIKE_GITHUB_REPOSITORY},GITHUB_BRANCH=main,DEFAULT_PHONE_REGION=CA,HISTORY_LIMIT=1000,DIAGNOSTIC_MODE=metadata" \
  --set-secrets='GITHUB_TOKEN=hike-github-token:latest,WEBHOOK_SECRET=hike-webhook-secret:latest,TEST_TOKEN=hike-test-token:latest'

export HIKE_SERVICE_URL="$(gcloud run services describe hike-tracker-webhook --region="$HIKE_REGION" --format='value(status.url)')"
curl "$HIKE_SERVICE_URL/health"
```

`--allow-unauthenticated` is necessary for email-webhook.com to reach the public HTTPS route; `WEBHOOK_SECRET` authenticates at the application layer. Cloud Run supplies a stable `https://…a.run.app` URL.

Test the production route after retrieving the test secret into a shell variable:

```bash
read -s 'HIKE_TEST_VALUE?Test token: '
curl -X POST "$HIKE_SERVICE_URL/test-location" \
  -H 'Content-Type: application/json' \
  -H "X-Test-Token: $HIKE_TEST_VALUE" \
  -d '{"phone":"+16045551234","message":"49.2827,-123.1207","messageId":"cloud-test-1"}'
unset HIKE_TEST_VALUE
```

Verify the new GitHub commit, wait for the Pages action, and open the returned hash URL.

## 5. Configure email-webhook.com

The current official payload is JSON with `from`, `to`, `subject`, `message`, and `attachments`. It sends a unique `X-email-webhook-id` header, which this backend uses as the preferred duplicate key. See [email-webhook.com's getting-started documentation](https://email-webhook.com/docs/getting-started).

1. Sign up and copy the generated `…@email-webhook.com` inbound address. Treat it as a secret.
2. Choose **New webhook**.
3. Set **Webhook URL** to `https://YOUR-CLOUD-RUN-HOST/webhook`.
4. Set **HTTP method** to `POST` and leave it enabled.
5. Add custom header `X-Webhook-Secret` with the exact value stored in `hike-webhook-secret`.
6. Initially leave sender filtering blank; the email delivered to this service will be forwarded by your own Gmail address, not necessarily by the SMS sender.
7. Send a direct test email and inspect email-webhook.com's Message Logs and Cloud Run logs.

The parser intentionally also accepts `body`, `text`, nested `email.*`, common Postmark-style names, HTML-only content, and forwarded `From:` lines so it is easy to adapt if the observed Gmail message differs.

## 6. Configure Google Voice and Gmail forwarding

Google currently documents **Google Voice → Settings → Messages → Forward messages to email**. This forwards notifications to the Gmail account associated with the Voice number; it does not directly target the email-webhook.com address. See [Google Voice Help](https://support.google.com/voice/answer/165221?co=GENIE.Platform%3DDesktop&hl=en).

1. In Google Voice on the web, open **Settings → Messages** and enable **Forward messages to email**.
2. Send one ordinary SMS to the Voice number and confirm the notification arrives in Gmail.
3. In Gmail, open **Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address** and enter the generated email-webhook.com address.
4. Gmail sends a verification message. Temporarily use Cloud Run `DIAGNOSTIC_MODE=raw` (instructions below) or point email-webhook.com at a request inspector so you can retrieve the confirmation link/code, then complete verification.
5. Turn off global forwarding. Open the known Google Voice notification in Gmail, choose **More → Filter messages like these**, verify that the search matches only Voice SMS notifications, then create the filter and select **Forward it to** the email-webhook.com address. Google notes that filters affect only new messages; see [Gmail forwarding help](https://support.google.com/mail/answer/10957?hl=en).
6. Keep Gmail's copy during the experiment so failed parses can be inspected.

Do not hard-code a guessed Gmail `From:` rule: use the first actual Voice notification to create the filter, because notification structure and account behavior can vary.

## 7. First-message diagnostic milestone

This is required before claiming the real SMS path works. Google Voice must retain the original sender number somewhere in the notification; the code cannot manufacture it if only a contact name is present.

Temporarily enable raw logging:

```bash
gcloud run services update hike-tracker-webhook \
  --region="$HIKE_REGION" \
  --update-env-vars='DIAGNOSTIC_MODE=raw'

gcloud run services logs tail hike-tracker-webhook --region="$HIKE_REGION"
```

Send one harmless Google Voice SMS with `49.2827,-123.1207`. Confirm in the log that:

1. The payload has the expected `from`, `subject`, and `message` fields.
2. The forwarded `message` contains the SMS body.
3. Either metadata or a forwarded header contains the original sender phone number.
4. The request has `X-email-webhook-id`.

Raw diagnostic mode logs full email content and may expose personal data. Disable it immediately:

```bash
gcloud run services update hike-tracker-webhook \
  --region="$HIKE_REGION" \
  --update-env-vars='DIAGNOSTIC_MODE=off'
```

If the sender is in a field the parser does not yet know, add its path to `backend/src/parser/message.ts`. If no original phone number exists anywhere, this architecture cannot support multiple senders as specified; use a different ingress provider or a single preconfigured tracker identity for a later experiment.

## 8. End-to-end acceptance test

1. Confirm `GET /health` returns `{"status":"ok"}`.
2. Send SMS text `49.2827,-123.1207` to the Google Voice number.
3. Confirm the notification appears in Gmail.
4. Confirm email-webhook.com records a `200` delivery to `/webhook`.
5. Inspect Cloud Run logs for masked sender, GPS, abbreviated hash, and successful GitHub update messages. Full SMS bodies and raw phone numbers are not logged when diagnostics are off.
6. Confirm `data/locations.json` received a commit containing the 64-character phone hash.
7. Confirm the GitHub Pages action finishes.
8. Open `https://USERNAME.github.io/REPOSITORY/?phone=HASH` and verify the marker, timestamp, and one-point history.
9. Send a second coordinate. Confirm the history and line update after the GitHub Pages deployment plus the next 60-second frontend poll.
10. Resend an identical delivery/message ID and confirm no extra history point appears.

Expected webhook statuses: `200` success/duplicate, `400` malformed payload or missing sender/body, `401` invalid secret, `422` no recognized/valid location, and `500` GitHub/internal failure.

## Known limitations and assumptions

- The central unproven assumption is that Google Voice's Gmail notification exposes the original sender phone number and exact SMS body. Diagnostic mode exists specifically to validate this.
- Unsalted SHA-256 phone hashes are guessable and the JSON is public. This is intentionally insecure for the MVP. Use random private share IDs, access control, and encrypted/private storage before tracking a real person.
- A location update becomes visible only after the GitHub API commit, the Pages workflow, CDN propagation, and the next browser poll. This can take more than a minute.
- GitHub is being used as a database. Concurrent writes get three SHA-conflict retries, but this is not appropriate for meaningful scale.
- Duplicate fallback fingerprints include coordinates, timestamp, subject, and body. Without a stable provider ID, semantically identical deliveries with changed timestamps can both be stored.
- Short `maps.app.goo.gl` links require an outbound HTTP redirect lookup. Network failure produces a clear 422 error.
- Public OpenStreetMap tiles have a usage policy and no offline guarantee. Choose an appropriate tile provider before wider use.
- GitHub Pages path-style links rely on its `404.html` fallback. Query-string links are canonical.
- Google Voice availability and texting constraints vary by country/account. Paid Google Voice texting is currently US-only, and Google warns it is intended for interactive, not bulk, messaging.
- Cloud Run may cold-start. email-webhook.com retry details should be validated with a deliberate temporary failure.

## Biggest risks for Apple satellite messaging

1. **Automation may not exist.** Apple's Messages via satellite is designed for user-driven conversations; iOS may not expose an unattended, periodic satellite-SMS automation path. This MVP proves the receiver/display side, not automatic sending.
2. **Delivery is opportunistic.** The user needs satellite visibility and may have to follow on-screen pointing guidance. Updates can be delayed, reordered, or never sent, so the map must never be treated as live safety telemetry.
3. **Message transformation.** Carrier, Apple, Google Voice, Gmail, and email forwarding can rewrite sender identity, URLs, timestamps, or formatting. Each hop must be tested on real hardware and in the intended region.
4. **Google Voice compatibility.** Satellite messages may not route to a Google Voice number at all, may arrive as a different message type, or may be filtered because they include URLs.
5. **Safety and privacy.** A public, guessable tracking URL and a best-effort delivery chain are unsuitable for emergency response. A production design needs explicit consent, private storage, stale-location warnings, redundancy, and a clear statement that it is not a rescue beacon.

## Deliberately deferred

TODOs for a later product: accounts, private links, encrypted storage, real authentication, database/Supabase storage, GPX and planned-route comparison, ETA, geofencing, check-in timers, emergency alerts, SMS replies, multiple hikers per account, hike expiration, sharing permissions, Apple Shortcuts, a native iOS app, automatic satellite sending, rate limits, abuse prevention, audit logs, and operational monitoring. None are part of this MVP.
