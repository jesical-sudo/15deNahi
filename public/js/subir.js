/**
 * subir.js — página de subida para invitados (mobile-first).
 * Redimensiona la foto en el propio celular antes de enviarla, para que
 * suba rápido incluso con el wifi del salón saturado de gente.
 */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);

  const MAX_DIM = 1600;
  const JPEG_QUALITY = 0.82;

  let compressedBlob = null;
  let config = null;

  async function loadConfig() {
    try {
      config = await FeedAdapter.getConfig();
      $("#hashtagLabel").textContent = "#" + config.hashtag.replace(/^#/, "");
      $("#brandName").textContent = config.eventName;
    } catch (_) { /* usa los valores por defecto del HTML */ }
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve({ img, url });
      img.onerror = reject;
      img.src = url;
    });
  }

  async function compress(file) {
    if (!file.type.startsWith("image/")) return file;
    try {
      const { img, url } = await fileToImage(file);
      let { width, height } = img;
      const scale = Math.min(1, MAX_DIM / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", JPEG_QUALITY));
    } catch (_) {
      return file; // si algo falla, se sube el original
    }
  }

  function setStatus(msg, isError) {
    const el = $("#statusMsg");
    el.textContent = msg || "";
    el.style.color = isError ? "var(--bad)" : "var(--good)";
  }

  function showSuccess() {
    $("#uploadCard").innerHTML = `
      <div class="success-screen">
        <div class="icon">💫</div>
        <h2>¡Listo!</h2>
        <p>Tu foto ya está en el muro. Gracias por acompañar a ${config ? config.eventName : "la festejada"}.</p>
        <button type="button" class="submit-btn" id="againBtn">Subir otra foto</button>
      </div>`;
    $("#againBtn").addEventListener("click", () => location.reload());
  }

  async function init() {
    await loadConfig();

    const picker = $("#photoPicker");
    const input = $("#photoInput");
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      setStatus("");
      picker.classList.add("has-image");
      picker.innerHTML = `<img alt="Vista previa" id="previewImg"><input type="file" id="photoInputReplacement" style="position:absolute;inset:0;opacity:0" accept="image/*">`;
      const previewUrl = URL.createObjectURL(file);
      $("#previewImg").src = previewUrl;
      compressedBlob = await compress(file);
    });

    $("#msgInput").addEventListener("input", (e) => {
      $("#msgCount").textContent = e.target.value.length;
    });

    $("#uploadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nombre = $("#nameInput").value.trim();
      const mensaje = $("#msgInput").value.trim();
      const file = input.files[0];

      if (!file) { setStatus("Elegí una foto para subir.", true); return; }
      if (!nombre) { setStatus("Contanos tu nombre.", true); $("#nameInput").focus(); return; }

      const btn = $("#submitBtn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Subiendo…';
      setStatus("");

      try {
        const blob = compressedBlob || file;
        const fd = new FormData();
        fd.append("nombre", nombre);
        fd.append("mensaje", mensaje);
        fd.append("hashtags", (config ? config.hashtag : "15deNahi").replace(/^#/, ""));
        fd.append("foto", blob, "foto.jpg");
        await FeedAdapter.upload(fd);
        showSuccess();
      } catch (err) {
        setStatus(err.message || "No se pudo subir la foto, probá de nuevo.", true);
        btn.disabled = false;
        btn.textContent = "Subir al muro ✨";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
