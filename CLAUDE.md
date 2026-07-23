# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

PWA de pedidos online para la pizzería FLUNA (Argentina). Sitio público (`index.html`) + panel de administración (`admin.html`), con Supabase como backend y una única Serverless Function en Vercel para generación de copy con IA.

**Idioma:** todo el código, comentarios, UI y commits están en español rioplatense. Mantenelo así.

## Stack y build

No hay build step, ni `package.json`, ni tests, ni linter. Son archivos estáticos servidos tal cual; todas las dependencias entran por CDN (`<script>` en el `<head>` de cada HTML):

- Tailwind CSS via `cdn.tailwindcss.com` con `tailwind.config` inline en cada HTML (paleta `fluna.orange #E96D25`, `fluna.dark`, `fluna.surface`) — si agregás un color de marca, hay que replicarlo en **ambos** HTML.
- Supabase JS v2, Mercado Pago SDK v2 (solo `index.html`), Chart.js (solo `admin.html`), Font Awesome 6.5.

Desarrollo local: cualquier static server desde la raíz (`npx serve .` o `python -m http.server`). Ojo: las funciones de `/api/` solo corren con `vercel dev` o en deploy. Sin ellas el generador de marketing falla, y el login del panel cae a un bypass que **solo** aplica en `localhost`.

Deploy: Vercel. `vercel.json` reescribe `/admin_fluna` → `/admin.html` (ruta "oculta" del panel) y define CSP, HSTS y `noindex` para el admin.

Variables de entorno en Vercel:

| Variable | Para qué |
|---|---|
| `ADMIN_PASSWORD` (o `PWR`) | contraseña del panel |
| `SUPABASE_URL` | base del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | acceso server-side que saltea RLS — **nunca al navegador** |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | tu aplicación de Mercado Pago (OAuth) |
| `MP_WEBHOOK_SECRET` | firma de las notificaciones |
| `MP_MARKETPLACE_FEE_PERCENT` | opcional, comisión de la plataforma |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | generador de marketing |
| `PUBLIC_BASE_URL` | opcional, si el dominio no se infiere bien de los headers |

## Arquitectura

Objetos globales tipo singleton, cada uno con `state` propio, colgados de `window` y sin módulos ES. El orden de los `<script>` importa: `utils.js` primero, después `supabase-config.js`, después la app.

- `FlunaUtils` (`js/utils.js`) — helpers compartidos. `esc()` (alias global de `escapeHtml`), `safeImageUrl`, `formatARS`, `toNumber`, `generateOrderId`, `readJSON`/`writeJSON`, `errorMessage`.
- `FlunaDB` (`js/supabase-config.js`) — **única capa de acceso a datos**. Todo CRUD, auth, storage, realtime y la llamada a la IA pasan por acá. Nunca invoques `supabase.from(...)` directo desde `app.js`/`admin.js`; agregá el método a `FlunaDB`. Todos los métodos devuelven `{ data, error }` y toleran que el cliente no exista.
- `FlunaApp` (`js/app.js`) — cliente: catálogo, carrito (persistido en `localStorage` como `fluna_cart`), checkout, tracker de pedido, chat, perfil, PWA.
- `FlunaAdmin` (`js/admin.js`) — panel: dashboard/KPIs, kanban de pedidos, CRUD productos/ingredientes/recetas, finanzas (P&L, EBITDA, cash flow), chat de atención, generador de marketing IA, pedidos manuales.
- `FlunaPayments` (`js/payments.js`) — Mercado Pago.

El render es imperativo: cada sección tiene un `renderX()` que reescribe `innerHTML` a partir de `state`, y los handlers se enganchan con `onclick=` inline en los templates generados. Después de mutar `state`, llamá al `renderX()` correspondiente.

**Regla no negociable al tocar cualquier `renderX()`:** todo dato que venga de la base o del usuario (nombres, direcciones, mensajes de chat, notas, descripciones, IDs) se interpola con `esc(...)`, y las URLs de imagen con `FlunaUtils.safeImageUrl(...)`. Como el markup se arma con template strings e `innerHTML`, un nombre de cliente con `<script>` se ejecutaría en el panel del local.

`index.html` y `admin.html` contienen todo el markup incluyendo los modales (ocultos con `hidden`, se muestran con `classList.remove('hidden'); classList.add('flex')`). Son archivos grandes (600 y 1130 líneas) — cuidado con anidar mal un modal, ya hubo bugs por eso.

### Datos (`schema.sql`)

Tablas: `products`, `orders`, `order_items`, `ingredients`, `purchases`, `finances`, `messages`, `product_recipes`.

Puntos no obvios:
- `orders.id` es **TEXT**, no UUID: formato `FL-XXXXXX` generado en el cliente con `FlunaUtils.generateOrderId()`. Como es PRIMARY KEY, `FlunaDB.createOrder()` reintenta con un ID nuevo ante un `23505` (unique_violation). No generes IDs de pedido a mano.
- `createOrder()` devuelve `{ data, error, itemsError }`. `itemsError` significa que el pedido entró pero sus items no: hay que avisarlo, no darlo por bueno.
- Los estados de pedido son strings en español y el kanban depende de esa lista exacta: `Solicitado`, `Falta de pago`, `Aprobada`, `En cocina`, `Terminado`, `Embalando`, `En camino`, `Entregado`, `Cancelado`.
- El trigger `fn_sync_order_finance` es la **única** fuente del ingreso por venta en `finances` (dispara con `payment_status='approved'` o `status='Aprobada'`, en INSERT y en UPDATE). Nunca insertes ese asiento también desde el frontend: se contaría dos veces.
- **RLS está cerrado** (aplicado el 2026-07-23 vía `supabase_setup.sql`). El menú es de lectura pública; pedidos y chat solo los ve su dueño (`customer_id = auth.uid()::text`) o el admin; finanzas, insumos, compras y recetas son solo admin. La función `public.is_admin()` lee el rol del JWT.
- Consecuencia práctica: **el chat requiere login**. Sin sesión no hay forma de probar qué conversación es de quién, así que `app.js` muestra un prompt de ingreso en vez del hilo.
- **`mp_integrations` y `mp_oauth_pending` tienen RLS activo y cero políticas**, que en Postgres significa denegar todo — ni siquiera el admin las lee. Solo la `service_role` desde `/api`. Ahí viven los tokens de Mercado Pago. **No les agregues políticas nunca**: si el panel necesita datos, que pasen por `/api/mp-status`, que devuelve solo metadata.
- `supabase_setup.sql` es el archivo de setup completo y re-ejecutable (tablas de MP, recetas, y todas las políticas). `schema.sql` quedó como referencia del esquema base y **sus políticas abiertas ya no reflejan la realidad**.

### Estado que vive solo en el navegador

Varias cosas nunca llegan a la DB: `fluna_cart`, `fluna_archived_chats`, `fluna_mk_history` (historial de marketing) y `fluna_anon_chat_id` en `localStorage`; `fluna_admin_logged` en `sessionStorage`. Leelas siempre con `FlunaUtils.readJSON()`, que descarta el valor si está corrupto en vez de tirar una excepción en el arranque.

`fluna_anon_chat_id` existe porque el chat también funciona sin login: sin un ID anónimo estable, todos los visitantes compartirían el `customer_id` vacío y verían la conversación de los demás.

### Auth del admin

`FlunaAdmin.handleAdminLogin()` valida contra `/api/admin-login`, que compara con `ADMIN_PASSWORD` (o `PWR`) usando comparación de tiempo constante y rate limiting best-effort. La contraseña ya no viaja en el JS público.

Sigue siendo un gate de UI: el panel lee y escribe en Supabase desde el navegador con la publishable key, así que la protección real de los datos son las políticas RLS. Si la función no está disponible, el login solo hace bypass en `localhost` (desarrollo). No agregues un fallback que aplique en producción.

### Pagos (Mercado Pago Checkout Pro)

Flujo completo, todo el dinero server-side:

1. El local conecta su cuenta desde **Integraciones** → `/api/mp-connect` → OAuth → `/api/mp-callback` guarda los tokens en `mp_integrations`.
2. El cliente elige Mercado Pago → `js/payments.js` llama a `/api/create-preference` mandando **solo el `orderId`**.
3. `create-preference` lee el pedido y sus items con la service role key, arma la preferencia y redirige al Checkout Pro.
4. Mercado Pago notifica a `/api/mp-webhook`, que valida la firma, consulta el pago y actualiza el pedido.
5. El trigger de la base inserta el ingreso en `finances`. El realtime dispara el toast en el panel.

Reglas que no se negocian al tocar esta parte:

- **El navegador nunca define importes ni estados de pago.** El monto sale de `order_items` server-side; si no coincide con `orders.total_amount` (tolerancia $1), `create-preference` se niega a cobrar.
- **El webhook es la única fuente de verdad.** Ningún camino del frontend escribe `payment_status='approved'`.
- **La firma del webhook es obligatoria.** Sin `MP_WEBHOOK_SECRET` el endpoint devuelve 503 en vez de aceptar notificaciones sin verificar — si no, cualquiera marca pedidos como pagados con un POST.
- **El webhook responde 200 salvo error propio.** Mercado Pago espera 200/201 en 22 segundos y reintenta cada 15 minutos; devolver 500 por un pedido inexistente genera reintentos infinitos.
- **Es idempotente**: si el patch no cambia nada, no escribe. Así el trigger de finanzas no duplica el ingreso ante notificaciones repetidas.
- **`marketplace_fee` es un monto en pesos, no un porcentaje.** Se calcula desde `MP_MARKETPLACE_FEE_PERCENT`.
- **Al renovar el token, el `refresh_token` también cambia** y hay que volver a guardarlo. `getValidAccessToken()` lo hace cuando faltan menos de 7 días.

`api/_lib/` son módulos internos: Vercel no publica como endpoint nada que empiece con `_`.

### Sesión del panel

El panel se abre con un **usuario real de Supabase Auth** que tiene `app_metadata.role = 'admin'` (hoy `admin@fluna.com`). Ese mismo JWT es el que hace cumplir RLS en la base, así que hay una sola identidad para panel y datos.

- `FlunaAdmin.adminFetch()` manda el `access_token` en `Authorization: Bearer` y maneja el 401.
- Los endpoints privados lo validan con `rejectIfNotAdmin()`, que consulta `/auth/v1/user` y comprueba el rol. Se valida contra Supabase en vez de verificar la firma localmente para respetar logout y revocaciones al instante.
- El rol se lee de `app_metadata`, **nunca** de `user_metadata`: ese último lo puede editar el propio usuario.
- `/api/mp-connect` es **POST y devuelve la URL**, no un redirect directo, para que el token viaje por header y no quede escrito en una URL (historial, logs de proxy, header `Referer`).

**Realtime y RLS:** un canal abierto antes del login queda como anónimo y no recibe nada. Por eso las suscripciones de pedidos y chat se crean **después** de la sesión (`iniciarSesionAdmin` / `aplicarSesion`), previo `FlunaDB.setRealtimeAuth(token)`. Solo el canal de productos puede abrirse sin sesión, porque el menú es de lectura pública.

### IA de marketing (`api/generate-marketing.js`)

Única función serverless. Recibe `{ prompt }` por POST e intenta Groq (`llama-3.3-70b-versatile`) y, si falla, cae a Gemini Flash. Requiere `GROQ_API_KEY` / `GEMINI_API_KEY` en las env vars de Vercel. Nunca hardcodees claves acá — GitHub Push Protection ya bloqueó un push por eso.

### PWA

`sw.js` cachea los assets de `ASSETS_TO_CACHE` con estrategia network-first. **Si agregás o renombrás un JS/CSS, actualizá esa lista y subí `CACHE_NAME`** (hoy `fluna-pwa-v2`), o los usuarios seguirán con la versión vieja.

`NEVER_CACHE` excluye `/api/`, Supabase, el SDK de Mercado Pago y las imágenes generadas: son datos vivos y servirlos desde caché mostraría pedidos viejos como si fueran actuales.

## Reglas de contenido (`.agents/AGENTS.md`)

- Cada copy se escribe optimizado tanto para SEO tradicional como para GEO (legible/citeable por modelos de IA).
- Copywriting persuasivo y humano, en segunda persona con voseo ("vos", "tu pedido", "tus pizzas").
- HTML5 semántico obligatorio: jerarquía correcta de `h1`-`h6`, metaetiquetas, JSON-LD (ya hay dos bloques en `index.html`) y `sitemap.xml` actualizado.

Información de la marca (tono, productos, datos del local) en `brand/informacion.md`.
