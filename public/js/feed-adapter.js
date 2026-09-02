/**
 * feed-adapter.js
 * Capa de datos del muro: habla con el servidor (server/server.js) y
 * expone una interfaz única para app.js y subir.js. Si el día de mañana
 * se conecta Instagram de verdad, esto no cambia — solo cambia qué
 * "fuente" trae los posts en el servidor.
 */
(function (global) {
  "use strict";

  const JSON_HEADERS = { "Content-Type": "application/json" };

  async function req(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch (_) { /* sin cuerpo JSON */ }
    if (!res.ok) {
      const msg = (body && body.error) || `Error ${res.status}`;
      throw new Error(msg);
    }
    return body;
  }

  const FeedAdapter = {
    async getConfig() {
      return req("/api/config");
    },

    async getPosts({ source = "invitados", hashtags = [] } = {}) {
      const params = new URLSearchParams({ source });
      if (hashtags.length) params.set("hashtags", hashtags.join(","));
      return req(`/api/posts?${params.toString()}`);
    },

    /** Sube una foto de invitado (multipart/form-data). */
    async upload(formData) {
      return req("/api/upload", { method: "POST", body: formData });
    },

    async like(id) {
      return req(`/api/posts/${encodeURIComponent(id)}/like`, { method: "POST" });
    },

    async hide(id) {
      return req(`/api/moderate/hide`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    },
    async restore(id) {
      return req(`/api/moderate/restore`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    },
    async getHidden() {
      return req("/api/moderate/hidden");
    },
    async getWords() {
      return req("/api/moderate/words");
    },
    async setWords(payload) {
      return req("/api/moderate/words", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
    },

    async login(pin) {
      return req("/api/admin/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ pin }) });
    },
    async logout() {
      return req("/api/admin/logout", { method: "POST" });
    },
    async status() {
      return req("/api/admin/status");
    },

    /**
     * Se suscribe a actualizaciones en vivo (Server-Sent Events) y cae
     * a sondeo cada 12s si el navegador no puede abrir el stream.
     * `handler` recibe { posts, stats, event, newPost }.
     */
    subscribe(source, hashtags, handler) {
      let stopped = false;
      let pollTimer = null;
      let es = null;

      const startPolling = () => {
        if (pollTimer) return;
        const tick = async () => {
          if (stopped) return;
          try {
            const data = await FeedAdapter.getPosts({ source, hashtags });
            handler({ ...data, event: "sync" });
          } catch (_) { /* silencioso: reintenta en el próximo tick */ }
        };
        tick();
        pollTimer = setInterval(tick, 12000);
      };

      try {
        es = new EventSource("/api/stream");
        es.addEventListener("changed", async (ev) => {
          if (stopped) return;
          let msg = {};
          try { msg = JSON.parse(ev.data); } catch (_) { /* ignorado */ }
          try {
            const data = await FeedAdapter.getPosts({ source, hashtags });
            handler({ ...data, event: msg.type || "sync", newPost: msg.post });
          } catch (_) { /* se reintenta en el próximo evento */ }
        });
        es.onerror = () => {
          if (es) { es.close(); es = null; }
          if (!stopped) startPolling();
        };
      } catch (_) {
        startPolling();
      }

      // primer fetch inmediato para no esperar el primer evento
      FeedAdapter.getPosts({ source, hashtags })
        .then((data) => !stopped && handler({ ...data, event: "sync" }))
        .catch(() => {});

      return function unsubscribe() {
        stopped = true;
        if (es) es.close();
        if (pollTimer) clearInterval(pollTimer);
      };
    },
  };

  global.FeedAdapter = FeedAdapter;
})(window);
