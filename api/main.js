/* ctf://writeups — API pour Vercel (fonction serverless + Vercel Blob privé).
 *
 * Variables d'environnement (Vercel → Settings → Environment Variables) :
 *   BLOB_READ_WRITE_TOKEN  ajoutée automatiquement quand on connecte un store Blob au projet
 *   CW_PASSWORD            mot de passe du site (obligatoire)
 *
 * Toutes les routes passent ici grâce aux rewrites de vercel.json (?p=...).
 * Stockage :
 *   meta/index.json        liste des writeups (métadonnées + texte pour la recherche)
 *   writeups/<id>.json     writeup complet
 *   images/<nom>           images collées
 *   trash/<id>-<ts>.json   writeups supprimés (récupérables)
 *   cheatsheet.json        commandes perso
 */
import { put, get, del } from "@vercel/blob";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";

const META_KEYS = ["title", "ctf", "category", "difficulty", "points", "date", "status", "tags", "flag", "pageWidth", "pageTheme", "pinned"];
const ID_RE = /^[a-f0-9]{12}$/;
const IMG_RE = /^[a-z0-9_-]+\.(png|jpe?g|gif|webp|bmp)$/;
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
const MAX_UPLOAD = 4.3 * 1024 * 1024; // limite de corps des fonctions Vercel : 4,5 Mo

const password = () => process.env.CW_PASSWORD || "";
const configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN && password());
const sha = (s) => createHash("sha256").update(s).digest();
const sessionToken = () => createHash("sha256").update("cw-session:" + password()).digest("hex");

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

function isAuthed(req) {
  if (!configured()) return false;
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)cw_auth=([a-f0-9]{64})/);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(sessionToken());
  return a.length === b.length && timingSafeEqual(a, b);
}
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}

/* ---------- Blob ---------- */
async function readJSON(path) {
  try {
    const r = await get(path, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    if (e?.name === "BlobNotFoundError") return null;
    throw e;
  }
}
const writeJSON = (path, obj) =>
  put(path, JSON.stringify(obj), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });

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

  if (p === "health") return json({ mode: "cloud", configured: configured(), authed: isAuthed(req) });

  if (p === "login" && method === "POST") {
    if (!configured()) return json({ error: "site non configuré" }, 503);
    let body = {};
    try { body = await req.json(); } catch {}
    const ok = timingSafeEqual(sha(String(body.password || "")), sha(password()));
    if (!ok) { await new Promise((r) => setTimeout(r, 900)); return json({ error: "mot de passe incorrect" }, 401); }
    return json({ ok: true }, 200, { "set-cookie": `cw_auth=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }
  if (p === "logout") return json({ ok: true }, 200, { "set-cookie": "cw_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

  if (!configured()) return json({ error: "site non configuré : ajoute un store Blob et la variable CW_PASSWORD sur Vercel" }, 503);
  if (!isAuthed(req)) return json({ error: "non connecté" }, 401);
  if (method !== "GET" && !sameOrigin(req)) return json({ error: "origine refusée" }, 403);

  // Images
  let m = p.match(/^img\/(.+)$/);
  if (m) {
    if (!IMG_RE.test(m[1])) return json({ error: "nom invalide" }, 400);
    const r = await get("images/" + m[1], { access: "private" }).catch(() => null);
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
    await put("images/" + name, buf, { access: "private", addRandomSuffix: false, contentType: ctype });
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
      await del(path);
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
