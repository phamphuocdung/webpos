# Danny CRM POS

Standalone web CRM/POS for sales, customer management, staff roles, statistics, and inventory control.

## Open

Open `index.html` in a browser.

## Default Login

- ADMIN: `admin` / `admin123`

Create staff accounts from the Users page after signing in as admin.

## Online Encrypted DB

GitHub Pages cannot store a secure database by itself because it only serves frontend files. This project includes a separate Node.js backend in `server/` for online storage.

The backend stores the whole DB as an AES-256-GCM encrypted file. If someone gets only `db.enc.json`, they cannot read products, customers, sales, or users without `DATA_ENCRYPTION_KEY`.

Deploy `server/` to a Node.js host, set the environment variables shown in `server/.env.example`, then update `config.js`:

```js
window.APP_CONFIG = {
  API_URL: "https://your-backend-url",
};
```

After that, the GitHub Pages frontend will sign in through the backend and sync data to the encrypted online DB. Changes entered on a computer will appear on a phone after the phone reloads the website.

To clear existing test data in a deployed backend, run this command on the backend host:

```powershell
cd server
npm run reset-db
```
