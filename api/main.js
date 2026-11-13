/* ctf://writeups — API pour Vercel (fonction serverless + Vercel Blob privé).
 *
 * Variables d'environnement (Vercel → Settings → Environment Variables) :
 *   BLOB_STORE_ID          ajoutée automatiquement quand on connecte un store Blob au projet
 *                          (auth OIDC ; les anciens stores donnent BLOB_READ_WRITE_TOKEN, accepté aussi)
 *   CW_PASSWORD_BENJAMIN   mot de passe du compte benjamin (à défaut : l'ancien CW_PASSWORD)
 *   CW_PASSWORD_HUGO       mot de passe du compte hugo
 *
 * Toutes les routes passent ici grâce aux rewrites de vercel.json (?p=...).
 * Chaque compte a son propre espace : un compte ne peut ni lister, ni lire, ni modifier
 * les writeups, images ou commandes d'un autre (toutes les clés passent par K()).
 * Stockage (sous le préfixe du compte) :
 *   meta/index.json        liste des writeups (métadonnées + texte pour la recherche)
 *   writeups/<id>.json     writeup complet
 *   images/<nom>           images collées
 *   trash/<id>-<ts>.json   writeups supprimés (récupérables)
 *   cheatsheet.json        commandes perso
 */
import { put, get, del } from "@vercel/blob";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/* Comptes. benjamin garde l'emplacement d'origine (préfixe vide) : ses writeups existants restent en place. */
const USERS = {
  benjamin: { name: "Benjamin", prefix: "", legacy: "CW_PASSWORD" },
  hugo: { name: "Hugo", prefix: "u/hugo/" },
};
const session = new AsyncLocalStorage();          // compte de la requête en cours
const K = (path) => USERS[session.getStore()].prefix + path;

const META_KEYS = ["title", "ctf", "category", "difficulty", "points", "date", "status", "tags", "flag", "pageWidth", "pageTheme", "pinned"];
const ID_RE = /^[a-f0-9]{12}$/;
const IMG_RE = /^[a-z0-9_-]+\.(png|jpe?g|gif|webp|bmp)$/;
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
const MAX_UPLOAD = 4.3 * 1024 * 1024; // limite de corps des fonctions Vercel : 4,5 Mo

// Store Blob connecté avec un préfixe perso (ex. MONSTORE_READ_WRITE_TOKEN) : on le récupère quand même
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const k = Object.keys(process.env).find((k) => k.endsWith("_READ_WRITE_TOKEN") && String(process.env[k]).startsWith("vercel_blob_rw_"));
  if (k) process.env.BLOB_READ_WRITE_TOKEN = process.env[k];
}
// Nom de variable insensible à la casse : CW_PASSWORD_HUGO, CW_PASSWORD_hugo, cw_password_Hugo…
const envCI = (name) => { const k = Object.keys(process.env).find((x) => x.toUpperCase() === name); return k ? process.env[k] : ""; };
const passwordOf = (u) => (envCI("CW_PASSWORD_" + u.toUpperCase()) || (USERS[u].legacy && process.env[USERS[u].legacy]) || "").trim();
const userList = () => Object.entries(USERS).map(([id, u]) => ({ id, name: u.name, ready: Boolean(passwordOf(id)) }));
// Nouveaux stores Blob : BLOB_STORE_ID + jeton OIDC fourni par Vercel ; anciens : BLOB_READ_WRITE_TOKEN
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const missing = () => [!hasBlob() && "BLOB_STORE_ID", !userList().some((u) => u.ready) && "CW_PASSWORD_BENJAMIN"].filter(Boolean);
const configured = () => missing().length === 0;
const sha = (s) => createHash("sha256").update(s).digest();
const sessionToken = (u) => createHash("sha256").update(`cw-session:${u}:${passwordOf(u)}`).digest("hex");

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

/* Renvoie l'identifiant du compte connecté (cookie valide), sinon null */
function authedUser(req) {
  if (!configured()) return null;
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)cw_auth=([a-z]{1,20})\.([a-f0-9]{64})(?:;|$)/);
  if (!m || !Object.hasOwn(USERS, m[1]) || !passwordOf(m[1])) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sessionToken(m[1]));
  return a.length === b.length && timingSafeEqual(a, b) ? m[1] : null;
}
/* Protège l'API contre les requêtes envoyées par un autre site ouvert dans le navigateur.
   Sur Vercel, l'en-tête Host vu par la fonction n'est pas toujours le domaine public (proxy, alias,
   domaine perso) : on se fie d'abord à Sec-Fetch-Site, posé par le navigateur et non falsifiable par
   une page, puis on compare Origin à tous les noms d'hôte connus de la requête. */
function sameOrigin(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")];
  try { hosts.push(new URL(req.url).host); } catch {}
  return hosts.filter(Boolean).flatMap((h) => h.split(",")).some((h) => h.trim() === host);
}

/* ---------- Blob ---------- */
async function readJSON(path) {
  try {
    const r = await get(K(path), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (e?.name === "BlobNotFoundError") return null;
    throw e;
  }
}
const writeJSON = (path, obj) =>
  put(K(path), JSON.stringify(obj), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });

const plainText = (html) =>
  String(html || "").replace(/<img[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").slice(0, 20000);
const metaOf = ({ content, ...meta }) => ({ ...meta, text: plainText(content) });

async function updateIndex(fn) {
  const idx = (await readJSON("meta/index.json")) || [];
  const next = fn(idx);
  await writeJSON("meta/index.json", next);
  return next;
}

/* ---------- Routes ---------- */
async function handle(req, method) {
  const url = new URL(req.url, "http://x");
  const p = (url.searchParams.get("p") || "").replace(/^\/+|\/+$/g, "");

  const user = authedUser(req);
  if (p === "health") return json({ mode: "cloud", configured: configured(), missing: missing(), env: process.env.VERCEL_ENV || "", authed: Boolean(user), user, users: userList() });

  if (p === "login" && method === "POST") {
    if (!configured()) return json({ error: "site non configuré" }, 503);
    let body = {};
    try { body = await req.json(); } catch {}
    const who = String(body.user || "benjamin").toLowerCase();
    const known = Object.hasOwn(USERS, who) && Boolean(passwordOf(who));
    // comparaison toujours effectuée (même compte inconnu) pour ne rien révéler par le temps de réponse
    const ok = timingSafeEqual(sha(String(body.password || "")), sha(known ? passwordOf(who) : randomBytes(16).toString("hex"))) && known;
    if (!ok) { await new Promise((r) => setTimeout(r, 900)); return json({ error: "mot de passe incorrect" }, 401); }
    return json({ ok: true, user: who }, 200, { "set-cookie": `cw_auth=${who}.${sessionToken(who)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }
  if (p === "logout") return json({ ok: true }, 200, { "set-cookie": "cw_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

  if (!configured()) return json({ error: "site non configuré : ajoute un store Blob et la variable CW_PASSWORD_BENJAMIN sur Vercel" }, 503);
  if (!user) return json({ error: "non connecté" }, 401);
  if (method !== "GET" && !sameOrigin(req)) return json({ error: "origine refusée" }, 403);
  return session.run(user, () => userRoutes(req, method, p));
}

/* Routes d'un compte connecté : tout le stockage y est relatif à son espace (K) */
async function userRoutes(req, method, p) {

  // Images
  let m = p.match(/^img\/(.+)$/);
  if (m) {
    if (!IMG_RE.test(m[1])) return json({ error: "nom invalide" }, 400);
    const r = await get(K("images/" + m[1]), { access: "private" }).catch(() => null);
    if (!r || r.statusCode !== 200) return json({ error: "introuvable" }, 404);
    return new Response(r.stream, { headers: { "content-type": r.blob.contentType, "cache-control": "private, max-age=31536000, immutable" } });
  }

  if (p === "upload" && method === "POST") {
    const ctype = (req.headers.get("content-type") || "").split(";")[0].trim();
    const ext = IMG_EXT[ctype];
    if (!ext) return json({ error: "type non supporté : " + ctype }, 415);
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > MAX_UPLOAD) return json({ error: "image trop lourde (max 4 Mo)" }, 413);
    const name = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(5).toString("hex")}.${ext}`;
    await put(K("images/" + name), buf, { access: "private", addRandomSuffix: false, contentType: ctype });
    return json({ location: "/images/" + name });
  }

  if (p === "cheatsheet") {
    if (method === "GET") return json((await readJSON("cheatsheet.json")) || []);
    if (method === "PUT") {
      const items = await req.json();
      if (!Array.isArray(items)) return json({ error: "liste attendue" }, 400);
      await writeJSON("cheatsheet.json", items);
      return json({ ok: true });
    }
  }

  if (p === "writeups") {
    if (method === "GET") {
      const idx = (await readJSON("meta/index.json")) || [];
      return json(idx.sort((a, b) => (b.updated || 0) - (a.updated || 0)));
    }
    if (method === "POST") {
      const body = await req.json();
      const now = Date.now();
      const doc = Object.fromEntries(META_KEYS.map((k) => [k, body[k] ?? ""]));
      Object.assign(doc, { id: randomBytes(6).toString("hex"), content: body.content || "", tags: body.tags || [], created: now, updated: now });
      await writeJSON(`writeups/${doc.id}.json`, doc);
      await updateIndex((idx) => [metaOf(doc), ...idx.filter((w) => w.id !== doc.id)]);
      return json(doc, 201);
    }
  }

  m = p.match(/^writeups\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID_RE.test(id)) return json({ error: "introuvable" }, 404);
    const path = `writeups/${id}.json`;
    const doc = await readJSON(path);
    if (!doc) return json({ error: "introuvable" }, 404);
    if (method === "GET") return json(doc);
    if (method === "PUT") {
      const body = await req.json();
      for (const k of [...META_KEYS, "content"]) if (k in body) doc[k] = body[k];
      doc.updated = Date.now();
      await writeJSON(path, doc);
      await updateIndex((idx) => [metaOf(doc), ...idx.filter((w) => w.id !== id)]);
      const { content, ...meta } = doc;
      return json(meta);
    }
    if (method === "DELETE") {
      await writeJSON(`trash/${id}-${Date.now()}.json`, doc); // récupérable
      await del(K(path));
      await updateIndex((idx) => idx.filter((w) => w.id !== id));
      return json({ ok: true });
    }
  }

  return json({ error: "introuvable" }, 404);
}

const wrap = (method) => async (req) => {
  try { return await handle(req, method); }
  catch (e) { console.error(e); return json({ error: "erreur serveur : " + (e?.message || e) }, 500); }
};
export const GET = wrap("GET");
export const POST = wrap("POST");
export const PUT = wrap("PUT");
export const DELETE = wrap("DELETE");
