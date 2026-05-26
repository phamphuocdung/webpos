# Secure API Backend

This backend stores the CRM/POS database as one encrypted file. If someone downloads only the DB file, they see AES-256-GCM ciphertext, not customer, sale, product, or user data.

## Security Model

- `DATA_ENCRYPTION_KEY` stays on the server as an environment variable.
- `server/data/db.enc.json` is encrypted at rest.
- Login is handled by the backend.
- API requests require a signed bearer token.
- Do not commit `.env` or `server/data/`.

If an attacker gets both the DB file and server environment secrets, they can decrypt the data. For production, use a managed secret store and rotate keys periodically.

## Local Run

```powershell
cd server
npm run keygen
copy .env.example .env
# Put the generated key into DATA_ENCRYPTION_KEY and set SESSION_SECRET.
npm start
```

Then edit `../config.js`:

```js
window.APP_CONFIG = {
  API_URL: "http://localhost:8080",
};
```

## Deploy

Deploy this `server` folder to a Node.js host such as Render, Railway, Fly.io, or a VPS. Set these environment variables in the host:

- `DATA_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `CORS_ORIGIN=https://phamphuocdung.github.io`
- `DB_PATH=./data/db.enc.json`

After backend deploy, update frontend `config.js` with the backend URL and push to GitHub Pages.
