/**
 * server.js — backend del muro social de los 15 de Nahiara.
 *
 * Responsabilidades:
 *  - Servir el sitio estático (public/)
 *  - Recibir fotos de invitados (multipart), comprimirlas y guardarlas
 *  - Guardar todo en archivos JSON simples (data/) — no hace falta una
 *    base de datos para un evento de una noche
 *  - Avisar en vivo a las pantallas abiertas cuando llega una foto nueva
 *    (Server-Sent Events)
 *  - Moderación básica protegida con PIN (organizador/a)
 *  - Generar el QR que lleva a la página de subida
 *  - Dejar preparado (pero apagado por defecto) el modo Instagram
 */
"use strict";

require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");
const QRCode = require("qrcode");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const FEED_FILE = path.join(DATA_DIR, "feed.json");
const MOD_FILE = path.join(DATA_DIR, "moderacion.json");

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1509";
const EVENT_NAME = process.env.EVENT_NAME || "Nahiara";
const EVENT_TAGLINE = process.env.EVENT_TAGLINE || "Mis 15";
const EVENT_HASHTAG = (process.env.EVENT_HASHTAG || "#15deNahi").replace(/^#/, "");
const EVENT_DATE = process.env.EVENT_DATE || "2026-10-03";
const SITE_URL_ENV = (process.env.SITE_URL || "").replace(/\/$/, "");
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || "";
const IG_USER_ID = process.env.IG_USER_ID || "";
const IG_HASHTAG = (process.env.IG_HASHTAG || EVENT_HASHTAG).replace(/^#/, "");

// ---------------------------------------------------------------------------
// pequeño "motor" de archivos JSON con escritura serializada (evita que dos
// invitados subiendo al mismo tiempo se pisen el archivo)
// ---------------------------------------------------------------------------
const writeQueues = new Map();
function queued(file, fn) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(file, next.catch(() => {}));
  return next;
}
async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}
/** Lee, transforma y escribe un archivo como UNA sola operación en cola —
 * evita que dos escrituras simultáneas (dos invitados subiendo a la vez,
 * un like mientras el organizador modera) se pisen entre sí. `mutator`
 * recibe el contenido actual y devuelve el nuevo contenido a guardar. */
async function updateJson(file, fallback, mutator) {
  return queued(file, async () => {
    const current = await readJson(file, fallback);
    const updated = await mutator(current);
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf8");
    await fs.rename(tmp, file);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Server-Sent Events: avisa a todas las pantallas abiertas que algo cambió
// ---------------------------------------------------------------------------
const sseClients = new Set();
function broadcastChanged(type, extra) {
  const payload = JSON.stringify({ type, ...extra });
  for (const res of sseClients) {
    res.write(`event: changed\ndata: ${payload}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// sesión de organizador/a (PIN) — tokens en memoria, alcanza para un evento
// ---------------------------------------------------------------------------
const adminTokens = new Set();
const ADMIN_COOKIE = "muro_admin";
function requireAdmin(req, res, next) {
  const token = req.cookies[ADMIN_COOKIE];
  if (token && adminTokens.has(token)) return next();
  res.status(401).json({ error: "PIN de organizador requerido" });
}

// ---------------------------------------------------------------------------
// moderación automática
// ---------------------------------------------------------------------------
function normaliza(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
async function estaBloqueado(nombre, mensaje) {
  const mod = await readJson(MOD_FILE, { palabrasBloqueadas: [], nombresBloqueados: [] });
  const texto = normaliza(`${nombre} ${mensaje}`);
  const nombreN = normaliza(nombre);
  const porPalabra = (mod.palabrasBloqueadas || []).some((p) => p && texto.includes(normaliza(p)));
  const porNombre = (mod.nombresBloqueados || []).some((n) => n && nombreN === normaliza(n));
  return porPalabra || porNombre;
}

// ---------------------------------------------------------------------------
// Instagram (opcional) — Graph API oficial, ver README para requisitos y
// límites (30 hashtags únicos cada 7 días, cuenta Business/Creator, etc.)
// ---------------------------------------------------------------------------
let cachedHashtagId = null;
async function fetchInstagramPosts() {
  if (!IG_ACCESS_TOKEN || !IG_USER_ID) {
    return { posts: [], notice: "Instagram no está configurado todavía (ver README para conectarlo)." };
  }
  try {
    const base = "https://graph.facebook.com/v21.0";
    if (!cachedHashtagId) {
      const searchUrl = `${base}/ig_hashtag_search?user_id=${IG_USER_ID}&q=${encodeURIComponent(IG_HASHTAG)}&access_token=${IG_ACCESS_TOKEN}`;
      const searchRes = await fetch(searchUrl);
      const searchJson = await searchRes.json();
      if (!searchRes.ok || !searchJson.data || !searchJson.data.length) {
        throw new Error((searchJson.error && searchJson.error.message) || "No se encontró el hashtag en Instagram");
      }
      cachedHashtagId = searchJson.data[0].id; // se cachea: cada búsqueda cuenta para el límite de 30/7 días
    }
    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username";
    const mediaUrl = `${base}/${cachedHashtagId}/recent_media?user_id=${IG_USER_ID}&fields=${fields}&access_token=${IG_ACCESS_TOKEN}`;
    const mediaRes = await fetch(mediaUrl);
    const mediaJson = await mediaRes.json();
    if (!mediaRes.ok) throw new Error((mediaJson.error && mediaJson.error.message) || "Error consultando Instagram");

    const posts = (mediaJson.data || []).map((m) => ({
      id: "ig_" + m.id,
      nombre: m.username || "Instagram",
      mensaje: (m.caption || "").slice(0, 300),
      imagen: m.media_type === "VIDEO" ? (m.thumbnail_url || m.media_url) : m.media_url,
      hashtags: [IG_HASHTAG],
      fecha: m.timestamp,
      likes: m.like_count || 0,
      oculto: false,
      fuente: "instagram",
      permalink: m.permalink,
    }));
    return { posts, notice: null };
  } catch (err) {
    return { posts: [], notice: "No se pudo consultar Instagram: " + err.message };
  }
}

// ---------------------------------------------------------------------------
// utilidades de posts
// ---------------------------------------------------------------------------
function buildStats(posts) {
  const conteo = new Map();
  let ultima = null;
  posts.forEach((p) => {
    (p.hashtags || []).forEach((h) => conteo.set(h, (conteo.get(h) || 0) + 1));
    if (!ultima || new Date(p.fecha) > new Date(ultima)) ultima = p.fecha;
  });
  return {
    total: posts.length,
    porHashtag: Array.from(conteo.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    ultimaActualizacion: ultima,
  };
}

function siteUrl(req) {
  return SITE_URL_ENV || `${req.protocol}://${req.get("host")}`;
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", true);
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d" }));

// ---- rate limit muy simple para /api/upload (1 cada 4s por IP) -----------
const lastUpload = new Map();
function uploadRateLimit(req, res, next) {
  const ip = req.ip || "desconocido";
  const now = Date.now();
  const last = lastUpload.get(ip) || 0;
  if (now - last < 4000) {
    return res.status(429).json({ error: "Esperá unos segundos antes de subir otra foto." });
  }
  lastUpload.set(ip, now);
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("El archivo debe ser una imagen"));
    cb(null, true);
  },
});

// ---------------------------------------------------------------- /api/config
app.get("/api/config", (req, res) => {
  res.json({
    eventName: EVENT_NAME,
    tagline: EVENT_TAGLINE,
    hashtag: EVENT_HASHTAG,
    eventDate: EVENT_DATE,
    uploadUrl: `${siteUrl(req)}/subir.html`,
    instagramConfigured: Boolean(IG_ACCESS_TOKEN && IG_USER_ID),
  });
});

// ------------------------------------------------------------------ /api/posts
app.get("/api/posts", async (req, res) => {
  const source = req.query.source || "invitados";
  const hashtagsFilter = (req.query.hashtags || "").split(",").map((h) => h.trim()).filter(Boolean);
  let posts = [];
  let notice = null;

  if (source === "ejemplo") {
    posts = await readJson(FEED_FILE, []);
  } else if (source === "instagram") {
    const r = await fetchInstagramPosts();
    posts = r.posts;
    notice = r.notice;
  } else {
    posts = (await readJson(POSTS_FILE, [])).filter((p) => !p.oculto);
  }

  if (hashtagsFilter.length) {
    posts = posts.filter((p) => (p.hashtags || []).some((h) => hashtagsFilter.includes(h)));
  }
  posts.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  res.json({ posts, stats: buildStats(posts), notice });
});

app.post("/api/posts/:id/like", async (req, res) => {
  const { id } = req.params;
  let likes = null;

  await updateJson(POSTS_FILE, [], (posts) => {
    const post = posts.find((p) => p.id === id);
    if (post) { post.likes = (post.likes || 0) + 1; likes = post.likes; }
    return posts;
  });

  if (likes === null) {
    await updateJson(FEED_FILE, [], (feed) => {
      const post = feed.find((p) => p.id === id);
      if (post) { post.likes = (post.likes || 0) + 1; likes = post.likes; }
      return feed;
    });
  }

  if (likes === null) return res.status(404).json({ error: "No se encontró la foto" });
  broadcastChanged("like", { id });
  res.json({ likes });
});

// ------------------------------------------------------------------ /api/upload
app.post("/api/upload", uploadRateLimit, upload.single("foto"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta la foto" });
    const nombre = (req.body.nombre || "").trim().slice(0, 60);
    const mensaje = (req.body.mensaje || "").trim().slice(0, 300);
    if (!nombre) return res.status(400).json({ error: "Falta el nombre" });

    const hashtags = (req.body.hashtags || EVENT_HASHTAG)
      .split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean);

    const id = "qr_" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    const filename = id + ".jpg";
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await sharp(req.file.buffer)
      .rotate() // respeta la orientación EXIF del celular
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(path.join(UPLOADS_DIR, filename));

    const oculto = await estaBloqueado(nombre, mensaje);

    const post = {
      id,
      nombre,
      mensaje,
      imagen: "/uploads/" + filename,
      hashtags,
      fecha: new Date().toISOString(),
      likes: 0,
      oculto,
      fuente: "qr",
    };

    await updateJson(POSTS_FILE, [], (posts) => { posts.unshift(post); return posts; });

    if (!oculto) broadcastChanged("new", { post });
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message || "No se pudo procesar la foto" });
  }
});

// -------------------------------------------------------------------- /api/qr
app.get("/api/qr.png", async (req, res) => {
  const url = `${siteUrl(req)}/subir.html`;
  const buffer = await QRCode.toBuffer(url, {
    width: 480,
    margin: 1,
    color: { dark: "#1a1520", light: "#ffffffff" },
  });
  res.set("Content-Type", "image/png");
  if (req.query.download) res.set("Content-Disposition", 'attachment; filename="qr-muro.png"');
  res.send(buffer);
});

// ------------------------------------------------------------- /api/stream (SSE)
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": conectado\n\n");
  sseClients.add(res);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------------- /api/admin
app.post("/api/admin/login", (req, res) => {
  const { pin } = req.body || {};
  if (String(pin || "") !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: "PIN incorrecto" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.add(token);
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies[ADMIN_COOKIE];
  if (token) adminTokens.delete(token);
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});
app.get("/api/admin/status", (req, res) => {
  const token = req.cookies[ADMIN_COOKIE];
  res.json({ isAdmin: Boolean(token && adminTokens.has(token)) });
});

// ------------------------------------------------------------- /api/moderate
app.post("/api/moderate/hide", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  let found = false;
  await updateJson(POSTS_FILE, [], (posts) => {
    const post = posts.find((p) => p.id === id);
    if (post) { post.oculto = true; found = true; }
    return posts;
  });
  if (!found) return res.status(404).json({ error: "No se encontró la foto" });
  broadcastChanged("hidden", { id });
  res.json({ ok: true });
});
app.post("/api/moderate/restore", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  let found = false;
  await updateJson(POSTS_FILE, [], (posts) => {
    const post = posts.find((p) => p.id === id);
    if (post) { post.oculto = false; found = true; }
    return posts;
  });
  if (!found) return res.status(404).json({ error: "No se encontró la foto" });
  broadcastChanged("restored", { id });
  res.json({ ok: true });
});
app.get("/api/moderate/hidden", requireAdmin, async (req, res) => {
  const posts = await readJson(POSTS_FILE, []);
  res.json(posts.filter((p) => p.oculto).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)));
});
app.get("/api/moderate/words", requireAdmin, async (req, res) => {
  res.json(await readJson(MOD_FILE, { palabrasBloqueadas: [], nombresBloqueados: [] }));
});
app.post("/api/moderate/words", requireAdmin, async (req, res) => {
  const { palabrasBloqueadas = [], nombresBloqueados = [] } = req.body || {};
  await updateJson(MOD_FILE, { palabrasBloqueadas: [], nombresBloqueados: [] }, () => ({
    palabrasBloqueadas: palabrasBloqueadas.filter(Boolean).slice(0, 200),
    nombresBloqueados: nombresBloqueados.filter(Boolean).slice(0, 200),
  }));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n💃 Muro de ${EVENT_NAME} corriendo en http://localhost:${PORT}`);
  console.log(`   Subida de invitados: http://localhost:${PORT}/subir.html`);
  console.log(`   PIN de organizador/a: ${ADMIN_PIN}\n`);
});
