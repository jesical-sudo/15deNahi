/**
 * app.js — lógica del muro principal (pantalla grande del evento).
 */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    config: null,
    source: localStorage.getItem("muro_source") || "invitados",
    mode: localStorage.getItem("muro_mode") || "mosaico",
    speed: parseInt(localStorage.getItem("muro_speed") || "5", 10),
    playing: localStorage.getItem("muro_playing") !== "false",
    activeHashtags: safeJson(localStorage.getItem("muro_hashtags"), []),
    notify: localStorage.getItem("muro_notify") === "true",
    posts: [],
    stats: null,
    isAdmin: false,
    giantIndex: 0,
    seenIds: new Set(),
    unsubscribe: null,
    rotateTimer: null,
  };

  function safeJson(str, fallback) {
    try { return str ? JSON.parse(str) : fallback; } catch (_) { return fallback; }
  }

  function persist() {
    localStorage.setItem("muro_source", state.source);
    localStorage.setItem("muro_mode", state.mode);
    localStorage.setItem("muro_speed", String(state.speed));
    localStorage.setItem("muro_playing", String(state.playing));
    localStorage.setItem("muro_hashtags", JSON.stringify(state.activeHashtags));
    localStorage.setItem("muro_notify", String(state.notify));
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function initials(name) {
    return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr} h`;
    return `hace ${Math.floor(hr / 24)} d`;
  }

  // ---------------------------------------------------------------- header
  function renderHeader(config) {
    $("#brandName").textContent = config.eventName;
    $("#brandTagline").textContent = config.tagline;
    $("#hashtagPill").textContent = "#" + config.hashtag.replace(/^#/, "");
    $("#qrHashtag").textContent = "#" + config.hashtag.replace(/^#/, "");
  }

  function startCountdown(eventDateISO) {
    const target = new Date(eventDateISO + "T00:00:00");
    function tick() {
      const now = new Date();
      let diff = target - now;
      const box = $("#countdown");
      if (isNaN(target.getTime())) { box.hidden = true; return; }
      if (diff <= 0 && diff > -1000 * 60 * 60 * 24) {
        $("#cdDays").textContent = "🎉";
        $("#cdHours").textContent = "";
        $("#cdMins").textContent = "";
        box.setAttribute("aria-label", "¡Hoy es el día!");
        return;
      }
      if (diff <= 0) { box.hidden = true; return; }
      const days = Math.floor(diff / 86400000); diff -= days * 86400000;
      const hrs = Math.floor(diff / 3600000); diff -= hrs * 3600000;
      const mins = Math.floor(diff / 60000);
      $("#cdDays").textContent = days;
      $("#cdHours").textContent = String(hrs).padStart(2, "0");
      $("#cdMins").textContent = String(mins).padStart(2, "0");
    }
    tick();
    setInterval(tick, 30000);
  }

  // ---------------------------------------------------------------- ticker
  function renderTicker(stats, config) {
    if (!stats) return;
    const items = [];
    items.push(`📸 <strong>${stats.total}</strong> fotos compartidas`);
    (stats.porHashtag || []).forEach((h) => {
      items.push(`<span class="sep">#</span>${h.tag} · <strong>${h.count}</strong>`);
    });
    if (stats.ultimaActualizacion) {
      items.push(`última foto ${timeAgo(stats.ultimaActualizacion)}`);
    }
    items.push(`✨ ${config.eventName} — ${config.tagline}`);
    const html = items.map((i) => `<span class="ticker-item">${i}</span>`).join("");
    // duplicado para el loop continuo del marquee (translateX -50%)
    $("#tickerTrack").innerHTML = html + html;
  }

  // ------------------------------------------------------------ filtrado
  function visiblePosts() {
    let posts = state.posts.filter((p) => !p.oculto);
    if (state.activeHashtags.length) {
      posts = posts.filter((p) => (p.hashtags || []).some((h) => state.activeHashtags.includes(h)));
    }
    return posts.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }

  // ---------------------------------------------------------------- wall
  function postCardHTML(post, big) {
    const isNew = Date.now() - new Date(post.fecha).getTime() < 2 * 60 * 1000;
    return `
      <img src="${post.imagen}" alt="Foto de ${escapeHtml(post.nombre)}" loading="lazy">
      <div class="card-fade"></div>
      ${isNew ? '<span class="badge-new">Nueva</span>' : ""}
      <div class="card-meta">
        <div class="who">
          <span class="avatar">${initials(post.nombre)}</span>
          <span class="name">${escapeHtml(post.nombre)}</span>
        </div>
        <p class="caption">${escapeHtml(post.mensaje || "")}</p>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderWall() {
    const wall = $("#wall");
    const posts = visiblePosts();
    $("#emptyState").hidden = posts.length > 0;
    wall.className = "wall mode-" + state.mode;

    if (state.mode === "gigante") {
      if (state.giantIndex >= posts.length) state.giantIndex = 0;
      const post = posts[state.giantIndex];
      wall.innerHTML = post
        ? `<div class="giant-stage" data-id="${post.id}">${postCardHTML(post, true)}</div>`
        : "";
      return;
    }

    wall.innerHTML = posts
      .map((p) => `<article class="post-card" role="listitem" tabindex="0" data-id="${p.id}">${postCardHTML(p)}</article>`)
      .join("");
  }

  function attachWallEvents() {
    $("#wall").addEventListener("click", (e) => {
      const card = e.target.closest(".post-card, .giant-stage");
      if (!card) return;
      openModal(card.dataset.id);
    });
    $("#wall").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".post-card");
      if (!card) return;
      e.preventDefault();
      openModal(card.dataset.id);
    });
  }

  // ------------------------------------------------------------ rotación
  function stopRotation() {
    if (state.rotateTimer) clearInterval(state.rotateTimer);
    state.rotateTimer = null;
  }
  function startRotation() {
    stopRotation();
    if (!state.playing) return;
    state.rotateTimer = setInterval(() => {
      const posts = visiblePosts();
      if (!posts.length) return;
      if (state.mode === "gigante") {
        state.giantIndex = (state.giantIndex + 1) % posts.length;
        renderWall();
      } else if (state.mode === "carrusel") {
        const wall = $("#wall");
        const cards = $$(".post-card", wall);
        if (!cards.length) return;
        const idx = cards.findIndex((c) => Math.abs(c.getBoundingClientRect().left - wall.getBoundingClientRect().left) < 40);
        const next = cards[(idx + 1) % cards.length] || cards[0];
        next.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }, state.speed * 1000);
  }

  // ----------------------------------------------------------------- modal
  function openModal(id) {
    const post = state.posts.find((p) => p.id === id);
    if (!post) return;
    const backdrop = $("#modalBackdrop");
    const card = $("#modalCard");
    card.innerHTML = `
      <button type="button" class="modal-close" id="modalCloseBtn" aria-label="Cerrar">✕</button>
      <img src="${post.imagen}" alt="Foto de ${escapeHtml(post.nombre)}">
      <div class="modal-info">
        <div class="who">
          <span class="avatar">${initials(post.nombre)}</span>
          <span class="name" id="modalName">${escapeHtml(post.nombre)}</span>
        </div>
        <p class="caption">${escapeHtml(post.mensaje || "")}</p>
        <p class="eyebrow">${(post.hashtags || []).map((h) => "#" + h).join(" ")} · ${timeAgo(post.fecha)}</p>
        <div class="modal-actions">
          <button type="button" id="likeBtn">❤️ <span>${post.likes || 0}</span></button>
          ${post.permalink ? `<a class="btn" style="width:auto" href="${post.permalink}" target="_blank" rel="noopener">Ver en Instagram ↗</a>` : ""}
          ${state.isAdmin ? `<button type="button" class="danger" id="hideBtn">Ocultar del muro</button>` : ""}
        </div>
      </div>`;
    backdrop.hidden = false;
    $("#modalCloseBtn").addEventListener("click", closeModal);
    $("#likeBtn").addEventListener("click", async () => {
      try {
        const r = await FeedAdapter.like(post.id);
        post.likes = r.likes;
        $("#likeBtn span").textContent = r.likes;
      } catch (_) { toast("No se pudo dar me gusta"); }
    });
    const hideBtn = $("#hideBtn");
    if (hideBtn) hideBtn.addEventListener("click", async () => {
      try { await FeedAdapter.hide(post.id); toast("Foto ocultada"); closeModal(); }
      catch (_) { toast("No se pudo ocultar"); }
    });
  }
  function closeModal() { $("#modalBackdrop").hidden = true; }

  // ---------------------------------------------------------------- dock
  function bindDock() {
    $$(".dock-group [data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mode = btn.dataset.mode;
        state.giantIndex = 0;
        $$(".dock-group [data-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        persist();
        renderWall();
        startRotation();
      });
    });
    const playBtn = $("#playPauseBtn");
    function syncPlayBtn() {
      playBtn.textContent = state.playing ? "⏸" : "▶";
      playBtn.title = state.playing ? "Pausar rotación" : "Reanudar rotación";
      playBtn.setAttribute("aria-pressed", String(!state.playing));
    }
    syncPlayBtn();
    playBtn.addEventListener("click", () => {
      state.playing = !state.playing;
      persist();
      syncPlayBtn();
      startRotation();
    });
    const speed = $("#speedRange");
    speed.value = state.speed;
    $("#speedLabel").textContent = state.speed + " s";
    speed.addEventListener("input", () => {
      state.speed = parseInt(speed.value, 10);
      $("#speedLabel").textContent = state.speed + " s";
      persist();
      startRotation();
    });
  }

  // ------------------------------------------------------------------- QR
  function setupQr(config) {
    $("#qrImg").src = "/api/qr.png?t=" + Date.now();
    const closeBtn = $("#closeQr");
    const float = $("#qrFloat");
    if (sessionStorage.getItem("muro_qr_hidden") === "1") float.hidden = true;
    closeBtn.addEventListener("click", () => {
      float.hidden = true;
      sessionStorage.setItem("muro_qr_hidden", "1");
    });
  }

  // --------------------------------------------------------------- panel
  function panelHTML() {
    const sourceOptions = [
      { id: "invitados", title: "Invitados (QR)", desc: "Fotos subidas en vivo por el público desde su celular." },
      { id: "ejemplo", title: "Ejemplo", desc: "Fotos de muestra para probar el diseño antes del evento." },
      { id: "instagram", title: "Instagram", desc: state.config.instagramConfigured ? `Posts reales con #${state.config.hashtag}.` : "Todavía no configurado (ver README)." },
    ];
    return `
      <h2>Panel del organizador</h2>
      <p class="sub">Solo visible desde esta pantalla — el público no ve este panel.</p>

      <section>
        <label>Fuente de las fotos</label>
        <div class="source-options" id="sourceOptions">
          ${sourceOptions.map((o) => `
            <label class="radio-card ${state.source === o.id ? "active" : ""}" data-source="${o.id}">
              <input type="radio" name="source" value="${o.id}" style="display:none" ${state.source === o.id ? "checked" : ""} ${o.id === "instagram" && !state.config.instagramConfigured ? "disabled" : ""}>
              <div><strong>${o.title}</strong><br><span>${o.desc}</span></div>
            </label>`).join("")}
        </div>
      </section>

      <section>
        <label for="hashtagInput">Hashtags a mostrar (vacío = todos)</label>
        <div class="field-row">
          <input type="text" id="hashtagInput" placeholder="ej: familia">
          <button class="btn" id="addHashtagBtn" style="width:auto">Agregar</button>
        </div>
        <div class="chip-list" id="hashtagChips"></div>
      </section>

      <section>
        <div class="toggle-row">
          <label style="margin:0">Avisarme (notificación) cuando llega una foto nueva</label>
          <label class="switch">
            <input type="checkbox" id="notifyToggle" ${state.notify ? "checked" : ""}>
            <span class="track"></span>
          </label>
        </div>
      </section>

      <section>
        <label>Código QR</label>
        <button class="btn" id="copyLinkBtn" style="margin-bottom:8px">Copiar link para invitados</button>
        <button class="btn" id="downloadQrBtn">Descargar QR (PNG)</button>
      </section>

      <section id="adminSection"></section>
    `;
  }

  function adminSectionHTML() {
    if (!state.isAdmin) {
      return `
        <label>Moderación (protegida con PIN)</label>
        <div class="pin-gate">
          <input type="password" id="pinInput" inputmode="numeric" maxlength="8" placeholder="••••">
          <button class="btn primary" id="pinBtn" style="margin-top:12px">Entrar</button>
          <p class="error" id="pinError"></p>
        </div>`;
    }
    return `
      <label>Palabras bloqueadas (separadas por coma)</label>
      <textarea id="wordsInput" placeholder="ej: palabra1, palabra2"></textarea>
      <label style="margin-top:12px">Nombres bloqueados (separados por coma)</label>
      <textarea id="namesInput" placeholder="ej: Usuario molesto"></textarea>
      <button class="btn primary" id="saveWordsBtn" style="margin-top:12px">Guardar moderación</button>

      <label style="margin-top:20px">Fotos ocultas</label>
      <div class="hidden-list" id="hiddenList"><p class="eyebrow">Cargando…</p></div>

      <button class="btn" id="logoutBtn" style="margin-top:16px">Salir del modo organizador</button>
    `;
  }

  function renderHashtagChips() {
    const allTags = new Map();
    state.posts.forEach((p) => (p.hashtags || []).forEach((h) => allTags.set(h, (allTags.get(h) || 0) + 1)));
    const chips = $("#hashtagChips");
    if (!chips) return;
    if (!allTags.size) { chips.innerHTML = '<span class="eyebrow">Todavía no hay hashtags en uso.</span>'; return; }
    chips.innerHTML = Array.from(allTags.entries()).map(([tag, count]) => {
      const active = state.activeHashtags.includes(tag);
      return `<span class="chip ${active ? "active" : ""}" data-tag="${tag}">#${tag} · ${count}</span>`;
    }).join("");
    $$(".chip", chips).forEach((chip) => {
      chip.addEventListener("click", () => {
        const tag = chip.dataset.tag;
        const i = state.activeHashtags.indexOf(tag);
        if (i === -1) state.activeHashtags.push(tag); else state.activeHashtags.splice(i, 1);
        persist();
        renderHashtagChips();
        renderWall();
      });
    });
  }

  async function refreshHiddenList() {
    const list = $("#hiddenList");
    if (!list) return;
    try {
      const hidden = await FeedAdapter.getHidden();
      if (!hidden.length) { list.innerHTML = '<p class="eyebrow">No hay fotos ocultas.</p>'; return; }
      list.innerHTML = hidden.map((p) => `
        <div class="hidden-row" data-id="${p.id}">
          <img src="${p.imagen}" alt="">
          <div class="meta"><div class="name">${escapeHtml(p.nombre)}</div><div class="msg">${escapeHtml(p.mensaje || "")}</div></div>
          <button type="button" data-restore="${p.id}">Restaurar</button>
        </div>`).join("");
      $$("[data-restore]", list).forEach((btn) => btn.addEventListener("click", async () => {
        await FeedAdapter.restore(btn.dataset.restore);
        toast("Foto restaurada");
        refreshHiddenList();
      }));
    } catch (_) { list.innerHTML = '<p class="eyebrow">No se pudo cargar.</p>'; }
  }

  function bindPanelBase() {
    $$("[data-source]", $("#panel")).forEach((card) => {
      card.addEventListener("click", () => {
        const input = card.querySelector("input");
        if (input.disabled) { toast("Instagram no está configurado todavía (ver README)"); return; }
        state.source = card.dataset.source;
        persist();
        $$("[data-source]", $("#panel")).forEach((c) => c.classList.toggle("active", c === card));
        subscribeToSource();
      });
    });
    $("#addHashtagBtn").addEventListener("click", () => {
      const input = $("#hashtagInput");
      const tag = input.value.trim().replace(/^#/, "");
      if (tag && !state.activeHashtags.includes(tag)) {
        state.activeHashtags.push(tag);
        persist();
        renderHashtagChips();
        renderWall();
      }
      input.value = "";
    });
    $("#notifyToggle").addEventListener("change", async (e) => {
      if (e.target.checked && "Notification" in window) {
        const perm = await Notification.requestPermission();
        state.notify = perm === "granted";
        e.target.checked = state.notify;
      } else {
        state.notify = false;
      }
      persist();
    });
    $("#copyLinkBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.config.uploadUrl);
        toast("Link copiado");
      } catch (_) { toast(state.config.uploadUrl); }
    });
    $("#downloadQrBtn").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "/api/qr.png?download=1";
      a.download = "qr-" + state.config.hashtag.replace(/^#/, "") + ".png";
      a.click();
    });
    renderHashtagChips();
    renderAdminSection();
  }

  function renderAdminSection() {
    $("#adminSection").innerHTML = adminSectionHTML();
    if (!state.isAdmin) {
      $("#pinBtn").addEventListener("click", submitPin);
      $("#pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
    } else {
      FeedAdapter.getWords().then((w) => {
        $("#wordsInput").value = (w.palabrasBloqueadas || []).join(", ");
        $("#namesInput").value = (w.nombresBloqueados || []).join(", ");
      });
      $("#saveWordsBtn").addEventListener("click", async () => {
        const palabrasBloqueadas = $("#wordsInput").value.split(",").map((s) => s.trim()).filter(Boolean);
        const nombresBloqueados = $("#namesInput").value.split(",").map((s) => s.trim()).filter(Boolean);
        await FeedAdapter.setWords({ palabrasBloqueadas, nombresBloqueados });
        toast("Moderación guardada");
      });
      $("#logoutBtn").addEventListener("click", async () => {
        await FeedAdapter.logout();
        state.isAdmin = false;
        renderAdminSection();
      });
      refreshHiddenList();
    }
  }

  async function submitPin() {
    const pin = $("#pinInput").value.trim();
    try {
      await FeedAdapter.login(pin);
      state.isAdmin = true;
      renderAdminSection();
    } catch (_) {
      $("#pinError").textContent = "PIN incorrecto";
    }
  }

  function openPanel() {
    $("#panel").innerHTML = panelHTML();
    $("#panel").hidden = false;
    $("#panelBackdrop").hidden = false;
    bindPanelBase();
  }
  function closePanel() {
    $("#panel").hidden = true;
    $("#panelBackdrop").hidden = true;
  }

  // ------------------------------------------------------------- arranque
  function subscribeToSource() {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = FeedAdapter.subscribe(state.source, [], (data) => {
      const prevIds = state.seenIds;
      state.posts = data.posts || [];
      state.stats = data.stats || null;
      state.posts.forEach((p) => state.seenIds.add(p.id));

      const emptyP = $("#emptyState p");
      if (emptyP) {
        emptyP.textContent = data.notice
          || "Escaneá el código QR para subir la primera foto de la noche y aparecer acá al instante ✨";
      }

      if (data.event === "new" && data.newPost && !prevIds.has(data.newPost.id) && state.notify && "Notification" in window && Notification.permission === "granted") {
        new Notification("Nueva foto en el muro 💫", { body: `${data.newPost.nombre}: ${data.newPost.mensaje || ""}`.trim() });
      }
      renderWall();
      renderTicker(state.stats, state.config);
      renderHashtagChips();
    });
  }

  async function init() {
    attachWallEvents();
    bindDock();
    $$(".dock-group [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));

    $("#modalCloseBtn").addEventListener("click", closeModal);
    $("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closePanel(); } });

    $("#openPanelBtn").addEventListener("click", openPanel);
    $("#panelBackdrop").addEventListener("click", closePanel);

    const config = await FeedAdapter.getConfig();
    state.config = config;
    renderHeader(config);
    startCountdown(config.eventDate);
    setupQr(config);

    try { const s = await FeedAdapter.status(); state.isAdmin = !!s.isAdmin; } catch (_) {}

    subscribeToSource();
    startRotation();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
