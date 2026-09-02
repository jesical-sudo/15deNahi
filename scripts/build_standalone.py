#!/usr/bin/env python3
"""Genera public_standalone/preview.html: una vista previa de solo lectura
del muro, 100% autocontenida (CSS + fotos de ejemplo en base64, sin
servidor) para verla al instante. La versión real con subida en vivo por
QR es el proyecto completo (npm install && npm start)."""
import base64
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
CSS = open(os.path.join(ROOT, "public", "css", "style.css"), encoding="utf-8").read()
FEED = json.load(open(os.path.join(ROOT, "data", "feed.json"), encoding="utf-8"))

def b64_image(rel_path):
    p = os.path.join(ROOT, "public", rel_path.lstrip("/"))
    with open(p, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")

posts = []
for p in FEED:
    posts.append({**p, "imagen": b64_image(p["imagen"])})

POSTS_JSON = json.dumps(posts, ensure_ascii=False)

HTML = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview — Muro de los 15 de Nahiara</title>
<meta name="description" content="Vista previa de solo lectura, con fotos de ejemplo. La versión real con subida en vivo por QR está en el proyecto completo.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<style>
{CSS}
.preview-banner {{
  position: relative; z-index: 1; text-align: center; font-size: 0.8rem;
  color: var(--ink-faint); padding: var(--space-2); border-bottom: 1px solid var(--line);
  background: var(--bg-2);
}}
.preview-banner strong {{ color: var(--rose); }}
</style>
</head>
<body>
<div class="sparkle-field" aria-hidden="true"></div>
<div class="preview-banner">Vista previa de solo lectura con fotos de ejemplo · la subida en vivo por QR está en <strong>el proyecto completo</strong> (ver README)</div>

<header class="wall-header">
  <div class="brand">
    <h1 class="brand-name">Nahiara</h1>
    <span class="brand-tagline">Mis 15</span>
  </div>
  <div class="brand-meta">
    <span class="pill hashtag">#15deNahi</span>
    <span class="pill"><span class="dot" aria-hidden="true"></span> En vivo (ejemplo)</span>
  </div>
</header>

<div class="ticker" aria-hidden="true"><div class="ticker-track" id="tickerTrack"></div></div>

<main><div id="wall" class="wall mode-mosaico" role="list" aria-label="Fotos del evento"></div></main>

<div class="dock" role="toolbar" aria-label="Controles del muro">
  <div class="dock-group" role="group" aria-label="Modo de visualización">
    <button type="button" data-mode="mosaico" class="active">Mosaico</button>
    <button type="button" data-mode="carrusel">Carrusel</button>
    <button type="button" data-mode="gigante">Gigante</button>
  </div>
  <button type="button" class="icon-btn" id="playPauseBtn" title="Pausar rotación">⏸</button>
</div>

<div class="modal-backdrop" id="modalBackdrop" hidden>
  <div class="modal-card" id="modalCard" role="dialog" aria-modal="true"></div>
</div>

<script>
const POSTS = {POSTS_JSON};
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
let mode = "mosaico", playing = true, giantIndex = 0, timer = null;

function esc(s) {{ return String(s || "").replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[c]); }}
function initials(n) {{ return (n||"?").trim().split(/\\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }}

function cardHTML(p) {{
  return `<img src="${{p.imagen}}" alt="Foto de ${{esc(p.nombre)}}">
    <div class="card-fade"></div>
    <div class="card-meta">
      <div class="who"><span class="avatar">${{initials(p.nombre)}}</span><span class="name">${{esc(p.nombre)}}</span></div>
      <p class="caption">${{esc(p.mensaje||"")}}</p>
    </div>`;
}}

function render() {{
  const wall = $("#wall");
  wall.className = "wall mode-" + mode;
  if (mode === "gigante") {{
    if (giantIndex >= POSTS.length) giantIndex = 0;
    const p = POSTS[giantIndex];
    wall.innerHTML = p ? `<div class="giant-stage" data-id="${{p.id}}">${{cardHTML(p)}}</div>` : "";
    return;
  }}
  wall.innerHTML = POSTS.map(p => `<article class="post-card" role="listitem" tabindex="0" data-id="${{p.id}}">${{cardHTML(p)}}</article>`).join("");
}}

function renderTicker() {{
  const items = [`📸 <strong>${{POSTS.length}}</strong> fotos de ejemplo`, `✨ Nahiara — Mis 15`, `<span class="sep">#</span>15deNahi`];
  const html = items.map(i => `<span class="ticker-item">${{i}}</span>`).join("");
  $("#tickerTrack").innerHTML = html + html;
}}

function openModal(id) {{
  const p = POSTS.find(x => x.id === id);
  if (!p) return;
  $("#modalCard").innerHTML = `<button type="button" class="modal-close" id="modalCloseBtn" aria-label="Cerrar">✕</button>
    <img src="${{p.imagen}}" alt="Foto de ${{esc(p.nombre)}}">
    <div class="modal-info">
      <div class="who"><span class="avatar">${{initials(p.nombre)}}</span><span class="name">${{esc(p.nombre)}}</span></div>
      <p class="caption">${{esc(p.mensaje||"")}}</p>
    </div>`;
  $("#modalBackdrop").hidden = false;
  $("#modalCloseBtn").addEventListener("click", () => $("#modalBackdrop").hidden = true);
}}

$("#wall").addEventListener("click", e => {{ const c = e.target.closest(".post-card,.giant-stage"); if (c) openModal(c.dataset.id); }});
$("#modalBackdrop").addEventListener("click", e => {{ if (e.target.id === "modalBackdrop") $("#modalBackdrop").hidden = true; }});

$$(".dock-group [data-mode]").forEach(btn => btn.addEventListener("click", () => {{
  mode = btn.dataset.mode; giantIndex = 0;
  $$(".dock-group [data-mode]").forEach(b => b.classList.toggle("active", b === btn));
  render(); startRotation();
}}));

const playBtn = $("#playPauseBtn");
playBtn.addEventListener("click", () => {{
  playing = !playing;
  playBtn.textContent = playing ? "⏸" : "▶";
  startRotation();
}});

function startRotation() {{
  if (timer) clearInterval(timer);
  if (!playing) return;
  timer = setInterval(() => {{
    if (mode === "gigante") {{ giantIndex = (giantIndex + 1) % POSTS.length; render(); }}
  }}, 5000);
}}

renderTicker(); render(); startRotation();
</script>
</body>
</html>
"""

out_dir = os.path.join(ROOT, "public_standalone")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "preview.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(HTML)
print("listo:", out_path, "-", os.path.getsize(out_path) // 1024, "KB")
