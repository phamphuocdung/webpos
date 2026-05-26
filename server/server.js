const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadDotEnv();

const PORT = Number(process.env.PORT || 8080);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "./data/db.enc.json");
const SEED_PATH = path.resolve(__dirname, "seed-state.json");
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/login") {
      const { username, password } = await readJson(req);
      const state = readDb();
      const user = state.users.find((item) => item.username === username && item.password === password);

      if (!user) {
        sendJson(res, 401, { error: "INVALID_LOGIN" });
        return;
      }

      sendJson(res, 200, {
        token: signToken({ sub: user.id, name: user.name, role: user.role }),
        user: { id: user.id, name: user.name, role: user.role },
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      requireToken(req);
      sendJson(res, 200, readDb());
      return;
    }

    if (req.method === "PUT" && req.url === "/api/state") {
      requireToken(req);
      const nextState = await readJson(req);
      validateState(nextState);
      writeDb(nextState);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: error.code || "SERVER_ERROR" });
  }
});

server.listen(PORT, () => {
  ensureSecrets();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) writeDb(readSeed());
  console.log(`Secure CRM/POS API listening on http://localhost:${PORT}`);
});

function loadDotEnv() {
  const envPath = path.resolve(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureSecrets() {
  if (!process.env.DATA_ENCRYPTION_KEY) {
    throw new Error("DATA_ENCRYPTION_KEY is required. Run: npm run keygen");
  }

  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is required and must be at least 32 characters.");
  }
}

function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
}

function readDb() {
  ensureSecrets();
  if (!fs.existsSync(DB_PATH)) return readSeed();

  const payload = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const encrypted = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function writeDb(state) {
  ensureSecrets();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const key = getEncryptionKey();
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
  fs.writeFileSync(DB_PATH, JSON.stringify(payload, null, 2));
}

function getEncryptionKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must be base64 for exactly 32 bytes.");
  }
  return key;
}

function signToken(payload) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedHeader = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedBody = base64Url(JSON.stringify(body));
  const signature = hmac(`${encodedHeader}.${encodedBody}`);
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function requireToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");

  if (parts.length !== 3 || hmac(`${parts[0]}.${parts[1]}`) !== parts[2]) {
    throwHttp(401, "INVALID_TOKEN");
  }

  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throwHttp(401, "TOKEN_EXPIRED");
  }

  return payload;
}

function hmac(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function validateState(state) {
  const requiredArrays = ["users", "products", "customers", "sales"];
  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) throwHttp(400, "INVALID_STATE");
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(Object.assign(new Error("Payload too large"), { status: 413, code: "PAYLOAD_TOO_LARGE" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400, code: "INVALID_JSON" }));
      }
    });
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function throwHttp(status, code) {
  throw Object.assign(new Error(code), { status, code });
}
