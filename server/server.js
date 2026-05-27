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
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "dung.phamphuoc308@gmail.com").toLowerCase();
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let googleJwksCache = { expiresAt: 0, keys: [] };

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
      const state = normalizeState(readDb());
      const user = state.users.find((item) => item.username === username && item.password === password);

      if (!user) {
        sendJson(res, 401, { error: "INVALID_LOGIN" });
        return;
      }

      const shift = startShift(state, user, "password");
      addActivity(state, user, "LOGIN", "Password login");
      writeDb(state);
      sendJson(res, 200, {
        token: signToken({ sub: user.id, name: user.name, role: user.role, email: user.email || "", shiftId: shift.id }),
        user: { id: user.id, name: user.name, role: user.role, email: user.email || "", shiftId: shift.id, authProvider: "password" },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/google-login") {
      const { credential } = await readJson(req);
      const googleUser = await verifyGoogleIdToken(credential);
      const state = normalizeState(readDb());
      const user = upsertGoogleUser(state, googleUser);
      const shift = startShift(state, user, "google");
      addActivity(state, user, "LOGIN", "Google login");
      writeDb(state);

      sendJson(res, 200, {
        token: signToken({ sub: user.id, name: user.name, role: user.role, email: user.email, shiftId: shift.id }),
        user: { id: user.id, name: user.name, role: user.role, email: user.email, shiftId: shift.id, authProvider: "google" },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/logout") {
      const payload = requireToken(req);
      const state = normalizeState(readDb());
      const user = state.users.find((item) => item.id === payload.sub) || {
        id: payload.sub,
        name: payload.name,
        role: payload.role,
        email: payload.email || "",
      };
      endShift(state, payload.shiftId, user.id);
      addActivity(state, user, "LOGOUT", "Shift ended");
      writeDb(state);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      requireToken(req);
      sendJson(res, 200, normalizeState(readDb()));
      return;
    }

    if (req.method === "PUT" && req.url === "/api/state") {
      requireToken(req);
      const nextState = normalizeState(await readJson(req));
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

function normalizeState(state) {
  return {
    users: Array.isArray(state.users) ? state.users : [],
    products: Array.isArray(state.products) ? state.products : [],
    customers: Array.isArray(state.customers) ? state.customers : [],
    sales: Array.isArray(state.sales) ? state.sales : [],
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    shifts: Array.isArray(state.shifts) ? state.shifts : [],
  };
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
  const requiredArrays = ["users", "products", "customers", "sales", "activityLogs", "shifts"];
  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) throwHttp(400, "INVALID_STATE");
  }
}

function upsertGoogleUser(state, googleUser) {
  const email = googleUser.email.toLowerCase();
  const role = email === ADMIN_EMAIL ? "ADMIN" : "STAFF";
  const existing = state.users.find(
    (user) => user.googleSub === googleUser.sub || (user.email || "").toLowerCase() === email || (email === ADMIN_EMAIL && user.username === "admin")
  );

  if (existing) {
    existing.name = googleUser.name || existing.name || email;
    existing.email = email;
    existing.username = existing.username || email;
    existing.googleSub = googleUser.sub;
    existing.provider = "google";
    existing.role = role;
    return existing;
  }

  const user = {
    id: uid("user"),
    name: googleUser.name || email,
    username: email,
    password: "",
    role,
    email,
    googleSub: googleUser.sub,
    provider: "google",
  };
  state.users.push(user);
  return user;
}

function startShift(state, user, provider) {
  const openShift = state.shifts.find((shift) => shift.userId === user.id && !shift.endedAt);
  if (openShift) return openShift;

  const shift = {
    id: uid("shift"),
    userId: user.id,
    userName: user.name,
    email: user.email || "",
    role: user.role,
    provider,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  state.shifts.push(shift);
  return shift;
}

function endShift(state, shiftId, userId) {
  const shift =
    state.shifts.find((item) => item.id === shiftId && !item.endedAt) ||
    state.shifts
      .slice()
      .reverse()
      .find((item) => item.userId === userId && !item.endedAt);

  if (shift) shift.endedAt = new Date().toISOString();
}

function addActivity(state, user, type, details = "") {
  state.activityLogs.push({
    id: uid("log"),
    type,
    details,
    createdAt: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    role: user.role,
    email: user.email || "",
  });
}

async function verifyGoogleIdToken(token) {
  if (!process.env.GOOGLE_CLIENT_ID) throwHttp(500, "GOOGLE_CLIENT_ID_NOT_CONFIGURED");
  if (!token || typeof token !== "string") throwHttp(400, "MISSING_GOOGLE_CREDENTIAL");

  const parts = token.split(".");
  if (parts.length !== 3) throwHttp(401, "INVALID_GOOGLE_TOKEN");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (header.alg !== "RS256") throwHttp(401, "INVALID_GOOGLE_TOKEN");

  const key = await getGooglePublicKey(header.kid);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();

  const validSignature = verifier.verify(key, Buffer.from(parts[2], "base64url"));
  if (!validSignature) throwHttp(401, "INVALID_GOOGLE_TOKEN");
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) throwHttp(401, "INVALID_GOOGLE_AUDIENCE");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throwHttp(401, "INVALID_GOOGLE_ISSUER");
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throwHttp(401, "GOOGLE_TOKEN_EXPIRED");
  if (!payload.email || payload.email_verified !== true) throwHttp(401, "GOOGLE_EMAIL_NOT_VERIFIED");

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
  };
}

async function getGooglePublicKey(kid) {
  if (!googleJwksCache.keys.length || googleJwksCache.expiresAt < Date.now()) {
    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) throwHttp(502, "GOOGLE_CERTS_UNAVAILABLE");
    const cacheControl = response.headers.get("cache-control") || "";
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
    const jwks = await response.json();
    googleJwksCache = {
      keys: jwks.keys || [],
      expiresAt: Date.now() + maxAge * 1000,
    };
  }

  const jwk = googleJwksCache.keys.find((key) => key.kid === kid);
  if (!jwk) throwHttp(401, "GOOGLE_KEY_NOT_FOUND");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
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
