/* ctf://writeups — API pour Vercel (fonction serverless + base Upstash Redis).
 *
 * Variables d'environnement (Vercel → Settings → Environment Variables) :
 *   KV_REST_API_URL, KV_REST_API_TOKEN   ajoutées automatiquement quand on connecte une base
 *                          Upstash Redis au projet (Storage → Upstash → Redis). Les noms
 *                          UPSTASH_REDIS_REST_URL / _TOKEN sont acceptés aussi.
 *   CW_PASSWORD_BENJAMIN   mot de passe du compte benjamin (à défaut : l'ancien CW_PASSWORD)
 *   CW_PASSWORD_HUGO       mot de passe du compte hugo
 *
 * Pourquoi Redis et plus Vercel Blob : l'offre gratuite de Blob ne permet qu'environ 2 000 écritures
 * par mois ; la sauvegarde automatique l'épuisait en quelques séances et Vercel suspendait le stockage.
 *
 * Chaque compte a son propre espace : un compte ne peut ni lister, ni lire, ni modifier
 * les writeups, images ou commandes d'un autre (toutes les clés passent par K()).
 * Clés (préfixe cw:<compte>:) :
 *   idx            hash  id → métadonnées + texte (liste des writeups, mise à jour atomique)
 *   w:<id>         writeup complet (JSON)
 *   img:<nom>      image collée (base64)
 *   cheat          commandes perso (JSON)
 *   trash:<id>:<t> writeup supprimé, gardé 30 jours
 */
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const USERS = {
  benjamin: { name: "Benjamin", legacy: "CW_PASSWORD" },
  hugo: { name: "Hugo" },
};
const session = new AsyncLocalStorage();          // compte de la requête en cours
const K = (key) => `cw:${session.getStore()}:${key}`;

const META_KEYS = ["title", "ctf", "category", "difficulty", "points", "date", "status", "tags", "flag", "pageWidth", "pageTheme", "pinned"];
const ID_RE = /^[a-f0-9]{12}$/;
const IMG_RE = /^[a-z0-9_-]+\.(png|jpe?g|gif|webp|bmp)$/;
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
const MAX_UPLOAD = 4.3 * 1024 * 1024; // limite de corps des fonctions Vercel : 4,5 Mo (≈ 5,8 Mo en base64, sous les 10 Mo d'Upstash)
const TRASH_TTL = 30 * 24 * 3600;

// Nom de variable insensible à la casse : CW_PASSWORD_HUGO, CW_PASSWORD_hugo, cw_password_Hugo…
const envCI = (name) => { const k = Object.keys(process.env).find((x) => x.toUpperCase() === name); return k ? process.env[k] : ""; };
const passwordOf = (u) => (envCI("CW_PASSWORD_" + u.toUpperCase()) || (USERS[u].legacy && process.env[USERS[u].legacy]) || "").trim();
const userList = () => Object.entries(USERS).map(([id, u]) => ({ id, name: u.name, ready: Boolean(passwordOf(id)) }));
const redisUrl = () => (envCI("KV_REST_API_URL") || envCI("UPSTASH_REDIS_REST_URL")).replace(/\/+$/, "");
const redisToken = () => envCI("KV_REST_API_TOKEN") || envCI("UPSTASH_REDIS_REST_TOKEN");
const missing = () => [!(redisUrl() && redisToken()) && "KV_REST_API_URL", !userList().some((u) => u.ready) && "CW_PASSWORD_BENJAMIN"].filter(Boolean);
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

/* ---------- Upstash Redis (API REST, sans dépendance) ---------- */
class StoreError extends Error {}
async function redis(path, body) {
  const r = await fetch(redisUrl() + path, {
    method: "POST", headers: { authorization: "Bearer " + redisToken(), "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new StoreError(`base de données : ${j?.error || r.status + " " + r.statusText}`);
  return j;
}
/* Une commande : cmd("GET", clé) */
async function cmd(...args) {
  const j = await redis("", args);
  if (j.error) throw new StoreError("base de données : " + j.error);
  return j.result;
}
/* Plusieurs commandes atomiques (toutes ou aucune) */
async function tx(...cmds) {
  const j = await redis("/multi-exec", cmds);
  const bad = (Array.isArray(j) ? j : []).find((x) => x?.error);
  if (!Array.isArray(j) || bad) throw new StoreError("base de données : " + (bad?.error || j?.error || "transaction refusée"));
  return j.map((x) => x.result);
}
const readJSON = async (key) => { const v = await cmd("GET", K(key)); return v == null ? null : JSON.parse(v); };

const plainText = (html) =>
  String(html || "").replace(/<img[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").slice(0, 20000);
const metaOf = ({ content, ...meta }) => ({ ...meta, text: plainText(content) });

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

  if (!configured()) return json({ error: "site non configuré : connecte une base Upstash Redis et ajoute CW_PASSWORD_BENJAMIN sur Vercel" }, 503);
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
    const b64 = await cmd("GET", K("img:" + m[1]));
    if (b64 == null) return json({ error: "introuvable" }, 404);
    const ext = m[1].split(".").pop();
    const ctype = Object.entries(IMG_EXT).find(([, e]) => e === ext || (ext === "jpeg" && e === "jpg"))?.[0] || "application/octet-stream";
    return new Response(Buffer.from(b64, "base64"), { headers: { "content-type": ctype, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
  }

  if (p === "upload" && method === "POST") {
    const ctype = (req.headers.get("content-type") || "").split(";")[0].trim();
    const ext = IMG_EXT[ctype];
    if (!ext) return json({ error: "type non supporté : " + ctype }, 415);
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > MAX_UPLOAD) return json({ error: "image trop lourde (max 4 Mo)" }, 413);
    const name = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(5).toString("hex")}.${ext}`;
    await cmd("SET", K("img:" + name), buf.toString("base64"));
    return json({ location: "/images/" + name });
  }

  if (p === "cheatsheet") {
    if (method === "GET") return json((await readJSON("cheat")) || []);
    if (method === "PUT") {
      const items = await req.json();
      if (!Array.isArray(items)) return json({ error: "liste attendue" }, 400);
      await cmd("SET", K("cheat"), JSON.stringify(items));
      return json({ ok: true });
    }
  }

  if (p === "writeups") {
    if (method === "GET") {
      const vals = (await cmd("HVALS", K("idx"))) || [];
      return json(vals.map((v) => JSON.parse(v)).sort((a, b) => (b.updated || 0) - (a.updated || 0)));
    }
    if (method === "POST") {
      const body = await req.json();
      const now = Date.now();
      const doc = Object.fromEntries(META_KEYS.map((k) => [k, body[k] ?? ""]));
      Object.assign(doc, { id: randomBytes(6).toString("hex"), content: body.content || "", tags: body.tags || [], created: now, updated: now });
      await tx(["SET", K("w:" + doc.id), JSON.stringify(doc)], ["HSET", K("idx"), doc.id, JSON.stringify(metaOf(doc))]);
      return json(doc, 201);
    }
  }

  m = p.match(/^writeups\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID_RE.test(id)) return json({ error: "introuvable" }, 404);
    const doc = await readJSON("w:" + id);
    if (!doc) return json({ error: "introuvable" }, 404);
    if (method === "GET") return json(doc);
    if (method === "PUT") {
      const body = await req.json();
      for (const k of [...META_KEYS, "content"]) if (k in body) doc[k] = body[k];
      doc.updated = Date.now();
      // writeup + entrée de liste dans la même transaction : la liste ne peut plus perdre un writeup
      await tx(["SET", K("w:" + id), JSON.stringify(doc)], ["HSET", K("idx"), id, JSON.stringify(metaOf(doc))]);
      const { content, ...meta } = doc;
      return json(meta);
    }
    if (method === "DELETE") {
      await tx(["SET", K(`trash:${id}:${Date.now()}`), JSON.stringify(doc), "EX", String(TRASH_TTL)], ["DEL", K("w:" + id)], ["HDEL", K("idx"), id]);
      return json({ ok: true });
    }
  }

  return json({ error: "introuvable" }, 404);
}

const wrap = (method) => async (req) => {
  try { return await handle(req, method); }
  catch (e) {
    console.error(e);
    return json({ error: e instanceof StoreError ? e.message : "erreur serveur : " + (e?.message || e) }, e instanceof StoreError ? 503 : 500);
  }
};
export const GET = wrap("GET");
export const POST = wrap("POST");
export const PUT = wrap("PUT");
export const DELETE = wrap("DELETE");
