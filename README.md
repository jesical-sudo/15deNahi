# 💃 Muro social — Mis 15 de Nahiara (#15deNahi)

Muro en vivo para el salón: los invitados escanean un QR, suben su foto
desde el celular (sin necesidad de Instagram ni de crear cuenta) y aparece
al instante en la pantalla grande del evento.

## ⚡ Arranque rápido (para probarlo en tu computadora)

Necesitás tener instalado [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
npm start
```

Abrí **http://localhost:3000** — vas a ver el muro (vacío al principio,
usá el panel ⚙️ para cambiar la fuente a "Ejemplo" y ver cómo queda con
fotos de muestra). Para probar la subida, abrí
**http://localhost:3000/subir.html** desde tu celular (conectado al mismo
wifi que tu compu) o desde otra pestaña.

## 🧱 Cómo está armado

```
muro-nahiara/
├── server/server.js       # Backend: Express + subida de fotos + moderación + QR + SSE
├── public/
│   ├── index.html         # El muro (pantalla grande del salón)
│   ├── subir.html          # Página de subida para invitados (la que abre el QR)
│   ├── css/style.css       # Identidad visual (plateado · rosa · blanco · negro)
│   └── js/
│       ├── feed-adapter.js # Capa de datos: habla con el servidor
│       ├── app.js          # Lógica del muro: modos, rotación, panel, moderación
│       └── subir.js        # Lógica de la página de subida (comprime la foto antes de enviarla)
├── data/
│   ├── feed.json           # Fotos de "ejemplo" para probar el diseño antes del evento
│   ├── posts.json          # Fotos reales subidas por invitados (se llena solo)
│   └── moderacion.json     # Palabras y nombres bloqueados
├── uploads/                 # Fotos de invitados ya comprimidas (se llena solo)
└── .env.example              # Configuración (copialo a .env y editá)
```

## ⚙️ Configuración

Copiá `.env.example` a `.env` y completá lo que quieras cambiar:

```bash
cp .env.example .env
```

| Variable | Para qué sirve | Valor actual |
|---|---|---|
| `EVENT_NAME` | Nombre que aparece en grande | `Nahiara` |
| `EVENT_TAGLINE` | Frase junto al nombre | `Mis 15` |
| `EVENT_HASHTAG` | Hashtag del evento | `#15deNahi` |
| `EVENT_DATE` | Fecha (para la cuenta regresiva) | `2026-10-03` |
| `ADMIN_PIN` | PIN para entrar al panel de moderación | `1509` — **cambialo antes del evento** |
| `SITE_URL` | URL pública una vez desplegado (para el QR) | vacío = se detecta sola |

## 🎛️ Cómo se usa el día del evento

1. **Instalá y desplegá** el sitio (ver sección de abajo) antes de la fiesta.
2. Abrí el sitio en la **computadora o Smart TV conectada a la pantalla
   grande** del salón, en modo **Mosaico**, **Carrusel** o **Gigante**
   (botones abajo al centro).
3. El **QR** de la esquina inferior lleva directo a la página de subida —
   imprimilo también en las mesas o en la invitación si querés.
4. Cuando alguien sube una foto, aparece **al instante** en la pantalla
   (sin recargar — usa una conexión en vivo).
5. Tocá el ⚙️ para abrir el **panel del organizador**: ahí elegís la
   fuente de fotos (Invitados / Ejemplo / Instagram), filtrás por
   hashtag y activás avisos del navegador cuando llega una foto nueva.
6. La parte de **moderación** (palabras bloqueadas, ocultar fotos) está
   protegida con el PIN de `ADMIN_PIN` — así el resto de la gente que
   toque el panel no puede borrar ni ocultar nada.
7. Una foto con una palabra bloqueada (o de un nombre bloqueado) se oculta
   **automáticamente** al subirse; podés revisarla y restaurarla desde
   "Fotos ocultas" en el panel.

## 🚀 Desplegar para que funcione en el evento real

El sitio necesita correr en un servidor real (no alcanza con abrir el
`index.html` como archivo) porque las fotos se guardan del lado del
servidor. La forma más simple:

**Render.com** (gratis, recomendado para un evento de una noche):
1. Subí esta carpeta a un repositorio de GitHub.
2. En Render: "New Web Service" → conectá el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Agregá las variables de entorno del `.env` en la sección "Environment".
5. Cuando termine el deploy, esa URL es la que abrís en la pantalla del
   salón — el QR se genera solo con esa URL.

También funciona igual en Railway, Fly.io o cualquier VPS con Node.js.

> ⚠️ Los planes gratuitos de estos servicios suelen "dormir" el servidor
> si no recibe tráfico por un rato. Para la noche del evento conviene
> abrir el sitio un rato antes para que esté despierto, o usar un plan
> pago si el evento es importante.

### Fotos subidas: dónde quedan guardadas

Las fotos de invitados se guardan en la carpeta `uploads/` del servidor.
En Render (y la mayoría de los hosts gratuitos) el disco **no es
permanente**: si el servicio se reinicia, se pueden perder. Para un
evento de una noche normalmente no es un problema, pero si querés
guardarlas con seguridad, después del evento bajá la carpeta `uploads/`
completa (o conectá un storage externo tipo Cloudinary/S3 — no incluido
acá para no complicar el setup).

## 📸 Modo Instagram (opcional, para más adelante)

Ya tenés la cuenta de Instagram creada — cuando quieras activarlo:

1. Convertí la cuenta a **Business o Creator** (Configuración → Cuenta).
2. Creá una app en [developers.facebook.com](https://developers.facebook.com/documentation/instagram-platform/overview),
   agregá el producto Instagram y vinculá la cuenta.
3. Conseguí un **token de acceso** con permisos `instagram_basic` +
   `instagram_manage_insights`.
4. Completá en `.env`: `IG_ACCESS_TOKEN`, `IG_USER_ID`, `IG_HASHTAG`.
5. Reiniciá el servidor y elegí "Instagram" como fuente en el panel ⚙️.

**Limitaciones oficiales de Meta** (no son de este proyecto, son de la
API): la cuenta tiene que ser Business/Creator, hay un límite de **30
hashtags únicos consultados cada 7 días** por cuenta, 200 pedidos por
hora por token, y solo trae posts con imagen de cuentas públicas. Por
eso el modo recomendado para el evento es "Invitados (QR)" — funciona
al instante y sin estas restricciones.

## 🔒 Sobre la moderación y el PIN

El PIN (`ADMIN_PIN`) es una protección básica pensada para un evento
familiar, no un sistema de login con usuarios — cualquiera que lo sepa
puede entrar al modo organizador desde cualquier navegador. Alcanza
para que el público en general no pueda tocar la moderación, pero no lo
compartas más allá de quien vaya a moderar el muro esa noche.

## ⚠️ Aviso

Mostrar fotos de invitados en una pantalla pública implica pensar en
sus derechos de imagen (sobre todo si hay menores). El sistema incluye
moderación (ocultar fotos + palabras/nombres bloqueados) para ayudar,
pero la responsabilidad final es de quien organiza el evento.

---

Hecho a medida para los 15 de Nahiara ✨ #15deNahi — 3 de octubre de 2026.
