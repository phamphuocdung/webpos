const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadDotEnv();

const dbPath = path.resolve(__dirname, "..", process.env.DB_PATH || "./data/db.enc.json");
const seedPath = path.resolve(__dirname, "..", "seed-state.json");

if (!process.env.DATA_ENCRYPTION_KEY) {
  throw new Error("DATA_ENCRYPTION_KEY is required.");
}

const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, "base64");
if (key.length !== 32) {
  throw new Error("DATA_ENCRYPTION_KEY must be base64 for exactly 32 bytes.");
}

const state = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
const payload = {
  version: 1,
  algorithm: "aes-256-gcm",
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  data: encrypted.toString("base64"),
};

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2));
console.log(`Encrypted DB reset at ${dbPath}`);

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const keyName = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[keyName]) process.env[keyName] = value;
  }
}
