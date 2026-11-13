/* ctf://writeups — logique de l'application */
"use strict";

/* =====================================================================
   Constantes & utilitaires
   ===================================================================== */
const CATEGORIES = [
  ["Web", "#38bdf8"], ["Pwn", "#ff5c7a"], ["Reverse", "#c084fc"], ["Crypto", "#fbbf24"],
  ["Forensics", "#00e59b"], ["Stégano", "#f472b6"], ["OSINT", "#60a5fa"], ["Réseau", "#2dd4bf"],
  ["Machine / Boot2root", "#fb923c"], ["Hardware", "#a3e635"], ["Mobile", "#818cf8"],
  ["Prog / Algo", "#e879f9"], ["Misc", "#94a3b8"],
];
const CAT_COLOR = Object.fromEntries(CATEGORIES);
const catColor = (c) => CAT_COLOR[c] || "#64748b";
const STATUS = {
  solved: { label: "résolu", color: "#00e59b" },
  progress: { label: "en cours", color: "#fbbf24" },
  unsolved: { label: "non résolu", color: "#ff5c7a" },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, cls = "ico") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const matchAll = (hay, q) => { const h = norm(hay); return norm(q).split(/\s+/).filter(Boolean).every((t) => h.includes(t)); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pref = {
  get(k, d) { try { const v = localStorage.getItem("cw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cw." + k, JSON.stringify(v)); } catch {} },
};

/* Thème du site (clair / sombre) et thème de la page du writeup (auto = suit le site) */
const appTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const pageTheme = () => { const t = pref.get("pageTheme2", "auto"); return t === "light" || t === "dark" ? t : appTheme(); };

const state = {
  list: [], current: null, dirty: false, saving: null, timer: null, loading: false, editorReady: null,
  catFilter: pref.get("catFilter", ""), closedGroups: new Set(pref.get("closedGroups", [])),
  drawerTab: pref.get("drawerTab", "cheat"), cheatCat: "", custom: [], cheatView: [],
  vars: { ...window.CHEAT_VARS, ...pref.get("vars", {}) }, lastOp: null,
};

/* =====================================================================
   API
   ===================================================================== */
/* Deux modes :
   - "server"  : server.py tourne (./lancer.sh) → fichiers dans data/
   - "local"   : hébergement statique (Vercel, GitHub Pages…) → tout est stocké
                 dans le navigateur (IndexedDB), images incluses. */
const META_KEYS = ["title", "ctf", "category", "difficulty", "points", "date", "status", "tags", "flag", "pageWidth", "pageTheme", "pinned"];

const serverApi = {
  async req(method, url, body) {
    const r = await fetch(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401 && state.mode === "cloud") { await showLogin(); return serverApi.req(method, url, body); }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  },
  list: () => serverApi.req("GET", "/api/writeups"),
  get: (id) => serverApi.req("GET", "/api/writeups/" + id),
  create: (d) => serverApi.req("POST", "/api/writeups", d),
  update: (id, d) => serverApi.req("PUT", "/api/writeups/" + id, d),
  remove: (id) => serverApi.req("DELETE", "/api/writeups/" + id),
  cheat: () => serverApi.req("GET", "/api/cheatsheet"),
  saveCheat: (items) => serverApi.req("PUT", "/api/cheatsheet", items),
};

const idb = {
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open("ctf-writeups", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("writeups", { keyPath: "id" });
        r.result.createObjectStore("trash", { keyPath: "id" });
        r.result.createObjectStore("kv");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async run(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => res(req?.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  all: (s) => idb.run(s, "readonly", (st) => st.getAll()),
  get: (s, k) => idb.run(s, "readonly", (st) => st.get(k)),
  put: (s, v, k) => idb.run(s, "readwrite", (st) => (k === undefined ? st.put(v) : st.put(v, k))),
  del: (s, k) => idb.run(s, "readwrite", (st) => st.delete(k)),
};

const plainText = (html) => {
  const d = new DOMParser().parseFromString(html || "", "text/html");
  d.querySelectorAll("img").forEach((i) => i.remove()); // évite d'indexer les images base64
  return (d.body.textContent || "").replace(/\s+/g, " ").slice(0, 100000);
};
const stripContent = ({ content, ...meta }) => ({ ...meta, text: plainText(content) });
const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");

const localApi = {
  async list() { return (await idb.all("writeups")).map(stripContent).sort((a, b) => b.updated - a.updated); },
  async get(id) { const d = await idb.get("writeups", id); if (!d) throw new Error("introuvable"); return d; },
  async create(body) {
    const doc = Object.fromEntries(META_KEYS.map((k) => [k, body[k] ?? ""]));
    Object.assign(doc, { id: body.id && /^[a-z0-9]{12}$/.test(body.id) ? body.id : newId(), content: body.content || "", tags: body.tags || [], created: body.created || Date.now(), updated: body.updated || Date.now() });
    doc.title = doc.title || "";
    await idb.put("writeups", doc);
    return doc;
  },
  async update(id, body) {
    const doc = await localApi.get(id);
    for (const k of [...META_KEYS, "content"]) if (k in body) doc[k] = body[k];
    doc.updated = Date.now();
    await idb.put("writeups", doc);
    const { content, ...meta } = doc;
    return meta;
  },
  async remove(id) {
    const doc = await idb.get("writeups", id);
    if (doc) await idb.put("trash", { ...doc, id: id + "-" + Date.now() });
    await idb.del("writeups", id);
    return { ok: true };
  },
  async cheat() { return (await idb.get("kv", "cheatsheet")) || []; },
  async saveCheat(items) { await idb.put("kv", items, "cheatsheet"); return { ok: true }; },
};

let api = serverApi;

async function detectMode() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if ((r.headers.get("content-type") || "").includes("json")) {
      const h = await r.json();
      if (h.mode === "cloud" || h.mode === "server") return h;
    }
    const w = await fetch("/api/writeups", { cache: "no-store" }); // ancien server.py
    if (w.ok && (w.headers.get("content-type") || "").includes("json")) return { mode: "server", configured: true, authed: true };
  } catch {}
  return { mode: "local" };
}

/* ---- Cloud (Vercel) : connexion par mot de passe ---- */
let loginPromise = null;
function showLogin() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay lock";
    ov.id = "lockOverlay";
    ov.innerHTML = `
      <form class="modal login">
        <div class="login-logo"><svg viewBox="0 0 24 24"><path d="M6 21V3h1.8v1.3c3.2-1.8 6.2 1 9.4-.4v8.7c-3.2 1.4-6.2-1.4-9.4.4V21z"/></svg></div>
        <div class="prompt"><span class="u">guest@ctf</span>:<span class="p">~</span>$ sudo ./writeups</div>
        <h3>Accès protégé</h3>
        <p>Entre le mot de passe du site (variable <code>CW_PASSWORD</code> sur Vercel).</p>
        <input class="input mono" type="password" name="pw" placeholder="mot de passe" autocomplete="current-password" required>
        <div class="login-err" hidden></div>
        <button class="btn-primary wide" type="submit">Se connecter</button>
      </form>`;
    document.body.appendChild(ov);
    const form = $("form", ov), err = $(".login-err", ov), input = $("input", ov);
    input.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      $("button", form).disabled = true;
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: input.value }) }).catch(() => null);
      $("button", form).disabled = false;
      if (r?.ok) { ov.remove(); loginPromise = null; resolve(); return; }
      err.textContent = r ? (await r.json().catch(() => ({}))).error || "Erreur" : "Serveur injoignable";
      err.hidden = false;
      input.select();
      form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
    };
  });
  return loginPromise;
}

function showSetup(h = {}) {
  const miss = (h.missing || []).map((v) => `<code>${v}</code>`).join(" et ");
  const ov = document.createElement("div");
  ov.className = "overlay lock";
  ov.innerHTML = `
    <div class="modal wide">
      <h3>⚙ Dernière étape : configurer le stockage</h3>
      <p>Le site est en ligne, mais il faut lui donner un endroit où enregistrer tes writeups pour toujours. Sur <b>vercel.com</b>, dans ton projet :</p>
      ${miss ? `<p class="login-err">Variable(s) introuvable(s) dans le déploiement actuel${h.env ? ` (<b>${h.env}</b>)` : ""} : ${miss}</p>` : ""}
      <ol class="setup">
        <li><b>Storage</b> → <b>Create Database</b> → <b>Blob</b> → crée-le et <b>connecte-le</b> à ce projet.</li>
        <li><b>Settings</b> → <b>Environment Variables</b> → ajoute <code>CW_PASSWORD</code> = ton mot de passe (long et unique), en cochant bien l'environnement <b>Production</b>.</li>
        <li><b>Deployments</b> → les <b>⋯</b> du dernier déploiement → <b>Redeploy</b>. <b>Obligatoire</b> : une variable ajoutée n'est prise en compte que par un <i>nouveau</i> déploiement, recharger la page ne suffit pas.</li>
      </ol>
      <div class="acts"><button class="btn-primary" onclick="location.reload()">J'ai fini, recharger</button></div>
    </div>`;
  document.body.appendChild(ov);
}

async function logout() {
  await flush();
  await fetch("/api/logout", { method: "POST" });
  location.reload();
}

/* ---- Transfert des writeups restés dans le navigateur vers le serveur / le cloud ---- */
async function browserWriteups() {
  try {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [{ name: "ctf-writeups" }];
    if (!dbs.some((d) => d.name === "ctf-writeups")) return [];
    return await idb.all("writeups");
  } catch { return []; }
}
async function offerMigration() {
  const ws = await browserWriteups();
  if (!ws.length) return;
  const note = $("#modeNote");
  note.hidden = false;
  note.innerHTML = `📦 <b>${ws.length} writeup${ws.length > 1 ? "s" : ""}</b> enregistré${ws.length > 1 ? "s" : ""} uniquement dans ce navigateur. <button class="btn sm" id="migrateBtn">Les mettre à l'abri ${state.mode === "cloud" ? "dans le cloud" : "sur le disque"}</button>`;
  $("#migrateBtn").onclick = async () => {
    $("#migrateBtn").disabled = true;
    $("#migrateBtn").textContent = "transfert…";
    let n = 0;
    for (const w of ws) {
      try {
        const { id, created, updated, text, ...rest } = w;
        rest.content = await uploadDataImages(rest.content);
        await api.create(rest);
        await idb.put("trash", { ...w, id: w.id + "-migre-" + Date.now() }); // copie de sécurité locale
        await idb.del("writeups", w.id);
        n++;
      } catch (e) { toast("⚠ " + (w.title || "Sans titre") + " : " + e.message); }
    }
    state.list = await api.list();
    renderAll();
    note.hidden = true;
    toast(`✔ ${n} writeup${n > 1 ? "s" : ""} transféré${n > 1 ? "s" : ""}`);
  };
}

/* Remplace les images intégrées (data:...) par des fichiers envoyés au serveur */
async function uploadDataImages(html) {
  if (!html || !html.includes("data:image")) return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  for (const img of div.querySelectorAll('img[src^="data:image"]')) {
    try {
      const blob = await (await fetch(img.src)).blob();
      const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": blob.type || "image/png" }, body: blob });
      if (r.ok) img.src = (await r.json()).location;
    } catch {}
  }
  return div.innerHTML;
}

/* ---- Sauvegarde / import (les deux modes) ---- */
async function backup() {
  await flush();
  let writeups;
  try {
    if (state.mode === "local") writeups = await idb.all("writeups");
    else {
      // serveur local ou cloud : on récupère chaque writeup et on intègre ses images dans le fichier
      toast("Préparation de la sauvegarde…");
      writeups = [];
      for (const w of state.list) { const d = await api.get(w.id); d.content = await inlineImages(d.content); writeups.push(d); }
    }
  } catch (e) { return toast("⚠ Sauvegarde impossible : " + e.message); }
  const cheatsheet = state.mode === "local" ? await localApi.cheat() : state.custom;
  const data = { app: "ctf-writeups", version: 1, exported: new Date().toISOString(), writeups, cheatsheet };
  download(`writeups-backup-${today()}.json`, JSON.stringify(data), "application/json");
  pref.set("lastBackup", Date.now());
  toast(`Sauvegarde téléchargée (${writeups.length} writeup${writeups.length > 1 ? "s" : ""})`);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("⚠ Fichier invalide (JSON attendu)"); }
  const ws = Array.isArray(data) ? data : data.writeups;
  if (!Array.isArray(ws)) return toast("⚠ Ce fichier n'est pas une sauvegarde de writeups");
  const ok = await confirmModal({ title: "Importer la sauvegarde ?", text: `${ws.length} writeup(s) vont être ajoutés${state.mode === "local" ? " (ceux qui existent déjà avec le même identifiant seront remplacés)" : ""}.`, ok: "Importer" });
  if (!ok) return;
  await flush();
  let done = 0;
  for (const w of ws) {
    try {
      if (state.mode === "local") await localApi.create(w);
      else { const { id, created, updated, text, ...rest } = w; rest.content = await uploadDataImages(rest.content); await api.create(rest); }
      done++;
    } catch (e) { toast("⚠ " + (w?.title || "Sans titre") + " : " + e.message); }
  }
  if (Array.isArray(data.cheatsheet) && data.cheatsheet.length) {
    const known = new Set(state.custom.map((c) => c.id));
    state.custom = [...state.custom, ...data.cheatsheet.filter((c) => !known.has(c.id))];
    await saveCustom();
  }
  state.list = await api.list();
  renderAll();
  toast(`✔ ${done} writeup${done > 1 ? "s" : ""} importé${done > 1 ? "s" : ""}`);
}

function toast(msg) {
  const t = $("#toast");
  const warn = String(msg).startsWith("⚠");
  t.textContent = msg;
  t.classList.toggle("warn", warn);
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), warn ? 5000 : 2200);
}
async function copyText(text, msg = "Copié dans le presse-papiers") {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast("✔ " + msg);
}

/* =====================================================================
   Modèle & styles du contenu
   ===================================================================== */
const TEMPLATE = `
<h2>Énoncé</h2>
<blockquote><p>Colle ici la description du challenge…</p></blockquote>
<p><strong>Fichiers :</strong> <code>chall.zip</code> &nbsp;·&nbsp; <strong>Accès :</strong> <code>nc host 1337</code></p>
<h2>Reconnaissance</h2>
<p>Premières observations, outils utilisés, ce qui a mis sur la piste…</p>
<pre class="terminal">$ file chall
$ strings chall | grep -i flag</pre>
<h2>Exploitation</h2>
<p>Explique le raisonnement étape par étape. Colle tes captures d'écran directement (Ctrl+V).</p>
<pre class="language-python"><code>from pwn import *

r = remote("host", 1337)
r.interactive()</code></pre>
<h2>Flag</h2>
<div class="flag-box">FLAG{...}</div>
<h2>Ce que j'ai appris</h2>
<ul><li>…</li></ul>
<h2>Ressources</h2>
<ul><li><a href="https://book.hacktricks.wiki">HackTricks</a></li></ul>
<p></p>`;

const CONTENT_CSS = `
:root{--pw:820px;--acc:#00e59b;--cy:#22d3ee}
html{background:transparent}
body{max-width:var(--pw);margin:30px auto 70px;padding:58px 70px;background:#fff;color:#1d232b;
 min-height:calc(100vh - 100px);box-shadow:0 0 0 1px rgba(15,23,42,.07),0 2px 6px rgba(15,23,42,.04),0 18px 50px rgba(15,23,42,.1);border-radius:10px;
 font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.75;word-wrap:break-word;
 transition:max-width .2s ease}
@media (max-width:700px){body{margin:12px 8px 40px;padding:28px 20px}}
html.full body{max-width:none;margin:0;border-radius:0;box-shadow:none;min-height:100vh;padding:44px 6vw}
html.dark body{background:#0c1117;color:#d5dde6;box-shadow:0 0 0 1px rgba(148,170,196,.14),0 20px 60px rgba(0,0,0,.55)}
html.dark.full body{box-shadow:none;background:#0a0e13}
h1,h2,h3,h4{line-height:1.3;margin:1.7em 0 .6em;letter-spacing:-.3px;font-weight:750}
h1{font-size:32px} h2{font-size:24px} h3{font-size:19px} h4{font-size:16px}
h2::before{content:"#";font-family:"JetBrains Mono",monospace;color:#059669;margin-right:.45em;font-weight:600;opacity:.8}
h3::before{content:"##";font-family:"JetBrains Mono",monospace;color:#0891b2;margin-right:.45em;font-weight:600;opacity:.7;font-size:.85em}
html.dark h1,html.dark h2,html.dark h3{color:#f1f5f9}
html.dark h2::before{color:var(--acc);text-shadow:0 0 12px rgba(0,229,155,.5)} html.dark h3::before{color:var(--cy)}
body>*:first-child{margin-top:0}
p{margin:.75em 0}
a{color:#0a7bd1;text-decoration-thickness:1px;text-underline-offset:3px} html.dark a{color:#4cc9f0}
strong{font-weight:680} html.dark strong{color:#f8fafc}
img{max-width:100%;height:auto;border-radius:8px}
html.dark img{box-shadow:0 0 0 1px #1d2834}
figure.image{display:inline-block;margin:1em 0} figure.image figcaption{font-size:.84em;color:#6b7785;text-align:center;padding-top:6px;font-style:italic}
blockquote{margin:1.1em 0;padding:.7em 1.1em;border-left:3px solid #00b97d;background:rgba(0,185,125,.06);border-radius:0 8px 8px 0;color:inherit}
html.dark blockquote{background:rgba(0,229,155,.05);border-left-color:var(--acc)}
code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.86em;background:rgba(120,130,140,.14);padding:.14em .42em;border-radius:5px}
html.dark code{background:#141c25;color:#7ee7c4;border:1px solid #1d2834}
pre{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;line-height:1.6;background:#0a0f14 !important;color:#d6e2ee;
 padding:15px 18px;border-radius:10px;overflow:auto;white-space:pre;border:1px solid #1b2530;tab-size:4;margin:1.1em 0}
pre code{background:none !important;border:0 !important;padding:0;font-size:inherit;color:inherit}
pre[class*=language-],pre[class*=language-] code,code[class*=language-]{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;line-height:1.6;text-shadow:none;color:#d6e2ee;white-space:pre}
pre[class*=language-]{padding:15px 18px;margin:1.1em 0}
pre .token{background:none !important;text-shadow:none}
pre.terminal{background:#030507 !important;color:#7ff5c8;border-color:#13261f;position:relative;padding-top:36px;
 box-shadow:inset 0 0 40px rgba(0,229,155,.04)}
pre.terminal::before{content:"";position:absolute;top:12px;left:14px;width:9px;height:9px;border-radius:50%;background:#ff5f57;box-shadow:15px 0 #febc2e,30px 0 #28c840}
pre.terminal::after{content:"terminal";position:absolute;top:7px;right:12px;font-size:10px;color:#3c5a4d;letter-spacing:1px;text-transform:uppercase}
pre .token.comment,pre .token.prolog,pre .token.doctype,pre .token.cdata{color:#6b7f92;font-style:italic}
pre .token.punctuation{color:#b5c3d1}pre .token.property,pre .token.tag,pre .token.constant,pre .token.symbol,pre .token.deleted{color:#7ee787}
pre .token.boolean,pre .token.number{color:#79c0ff}pre .token.selector,pre .token.attr-name,pre .token.string,pre .token.char,pre .token.builtin,pre .token.inserted{color:#a5f3d0}
pre .token.operator,pre .token.entity,pre .token.url{color:#ff8b9b}pre .token.atrule,pre .token.attr-value,pre .token.keyword{color:#ff7b9c}
pre .token.function,pre .token.class-name{color:#d2a8ff}pre .token.regex,pre .token.important,pre .token.variable{color:#ffb86b}
.flag-box{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:14px;letter-spacing:.2px;background:linear-gradient(135deg,rgba(0,229,155,.13),rgba(34,211,238,.05));
 border:1px solid rgba(0,185,125,.5);color:#047857;padding:13px 16px 13px 46px;border-radius:10px;margin:1.1em 0;position:relative;font-weight:600}
.flag-box::before{content:"🚩";position:absolute;left:15px;top:50%;transform:translateY(-50%)}
html.dark .flag-box{color:#5cffc5;text-shadow:0 0 12px rgba(0,229,155,.45);border-color:rgba(0,229,155,.45);box-shadow:0 0 24px rgba(0,229,155,.08)}
.callout{padding:12px 16px 12px 46px;border-radius:10px;margin:1.1em 0;position:relative;border:1px solid}
.callout::before{position:absolute;left:15px;top:12px}
.callout.info{background:rgba(56,189,248,.07);border-color:rgba(56,189,248,.35)} .callout.info::before{content:"ℹ️"}
.callout.tip{background:rgba(0,229,155,.07);border-color:rgba(0,229,155,.35)} .callout.tip::before{content:"💡"}
.callout.warn{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.4)} .callout.warn::before{content:"⚠️"}
.callout.danger{background:rgba(255,92,122,.07);border-color:rgba(255,92,122,.4)} .callout.danger::before{content:"🔥"}
.callout>*:first-child{margin-top:0}.callout>*:last-child{margin-bottom:0}
kbd{font-family:"JetBrains Mono",monospace;font-size:.82em;padding:.1em .45em;border:1px solid #c8ced6;border-bottom-width:2px;border-radius:5px;background:#f6f8fa}
html.dark kbd{background:#141c25;border-color:#2a3746}
table{border-collapse:collapse;margin:1.1em 0;font-size:.94em} table td,table th{border:1px solid #d5dbe1;padding:7px 11px} table th{background:rgba(120,130,140,.09);font-weight:650;text-align:left}
html.dark table td,html.dark table th{border-color:#1f2a36} html.dark table th{background:#111821}
hr{border:0;height:1px;background:linear-gradient(90deg,transparent,#c7d0d9,transparent);margin:2.2em 0} html.dark hr{background:linear-gradient(90deg,transparent,#2a3746,transparent)}
mark{background:#fde68a;padding:0 .15em;border-radius:3px} html.dark mark{background:rgba(251,191,36,.3);color:#fff}
ul,ol{padding-left:1.6em} li{margin:.25em 0} li::marker{color:#00b97d}
html.dark li::marker{color:var(--acc)}
.mce-pagebreak{border-top:2px dashed #94a3b8;margin:2em 0}
details{border:1px solid #d0d7de;border-radius:10px;padding:8px 14px;margin:1em 0} html.dark details{border-color:#1f2a36;background:#0a0f14}
summary{cursor:pointer;font-weight:650}
::selection{background:rgba(0,229,155,.3)}
@media print{html,html.dark{background:#fff !important}body,html.dark body{box-shadow:none;margin:0;max-width:none;padding:0;background:#fff;color:#1d232b;min-height:0}
 html.dark h1,html.dark h2,html.dark h3,html.dark strong{color:#111} .mce-pagebreak,.pagebreak{page-break-before:always;border:0} pre{white-space:pre-wrap;page-break-inside:avoid}}
`;

/* =====================================================================
   Éditeur TinyMCE
   ===================================================================== */
function initEditor() {
  state.editorReady = new Promise((resolve) => {
    tinymce.init({
      selector: "#editor",
      license_key: "gpl",
      language: "fr_FR",
      skin: appTheme() === "dark" ? "oxide-dark" : "oxide",
      content_css: ["/vendor/fonts/fonts.css"],
      content_style: CONTENT_CSS,
      height: "100%",
      resize: false, promotion: false, branding: false, elementpath: false, help_accessibility: false, statusbar: false,
      browser_spellcheck: true,
      contextmenu: "link image table",
      plugins: "advlist autolink lists link image charmap preview anchor searchreplace visualblocks visualchars code fullscreen insertdatetime media table help wordcount codesample emoticons pagebreak nonbreaking quickbars accordion directionality",
      menubar: false,
      // Une seule ligne : ce qui ne tient pas passe dans le bouton « ⋯ » à droite
      toolbar: "undo redo | blocks fontsize | bold italic underline strikethrough winlinecode forecolor backcolor | bullist numlist | link image table | codesample wterminal wflag wcallouts | alignleft aligncenter alignright alignjustify | fontfamily lineheight outdent indent removeformat | media hr pagebreak accordion charmap emoticons insertdatetime | wtemplate searchreplace code preview fullscreen",
      toolbar_mode: "sliding",
      toolbar_sticky: true,
      font_family_formats:
        "Inter=Inter,system-ui,sans-serif; JetBrains Mono=JetBrains Mono,monospace; Courier New=courier new,courier,monospace; Arial=arial,helvetica,sans-serif; Georgia=georgia,serif; Times New Roman=times new roman,times,serif; Verdana=verdana,geneva,sans-serif",
      font_size_formats: "10px 11px 12px 13px 14px 15px 16px 18px 20px 24px 28px 32px 40px 48px",
      line_height_formats: "1 1.2 1.4 1.6 1.75 2 2.5",
      block_formats: "Paragraphe=p; Titre 1=h1; Titre 2=h2; Titre 3=h3; Titre 4=h4; Code (pre)=pre; Citation=blockquote",
      codesample_languages: [
        { text: "Python", value: "python" }, { text: "Bash / Shell", value: "bash" }, { text: "Console (sortie shell)", value: "shell-session" },
        { text: "C", value: "c" }, { text: "C++", value: "cpp" }, { text: "Assembleur (x86)", value: "nasm" },
        { text: "JavaScript", value: "javascript" }, { text: "PHP", value: "php" }, { text: "SQL", value: "sql" },
        { text: "HTML / XML", value: "markup" }, { text: "CSS", value: "css" }, { text: "Java", value: "java" },
        { text: "Go", value: "go" }, { text: "Rust", value: "rust" }, { text: "PowerShell", value: "powershell" },
        { text: "JSON", value: "json" }, { text: "YAML", value: "yaml" }, { text: "HTTP (requête/réponse)", value: "http" },
        { text: "Diff", value: "diff" }, { text: "Ruby", value: "ruby" }, { text: "C#", value: "csharp" },
        { text: "Dockerfile", value: "docker" }, { text: "INI / conf", value: "ini" }, { text: "Regex", value: "regex" },
        { text: "Texte brut", value: "none" },
      ],
      codesample_global_prismjs: true,
      image_caption: true, image_advtab: true, image_title: true,
      object_resizing: true, resize_img_proportional: true,
      paste_data_images: true, automatic_uploads: true,
      images_file_types: "png,jpg,jpeg,gif,webp,svg,bmp",
      images_upload_handler: uploadImage,
      file_picker_types: "image",
      convert_urls: false,
      link_default_target: "_blank",
      link_assume_external_targets: true,
      table_default_styles: { "border-collapse": "collapse" },
      quickbars_selection_toolbar: "bold italic winlinecode | quicklink h2 h3 blockquote | forecolor backcolor",
      quickbars_insert_toolbar: false,
      quickbars_image_toolbar: "alignleft aligncenter alignright | imageoptions",
      insertdatetime_formats: ["%d/%m/%Y", "%H:%M", "%d/%m/%Y %H:%M"],
      formats: { inlinecode: { inline: "code", remove: "all" } },
      setup(ed) {
        ed.ui.registry.addIcon("flagicon", '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M6 21V4h1v1.3c3.2-1.7 6.4.9 9.6-.4v8.3c-3.2 1.3-6.4-1.3-9.6.4V21z" fill="currentColor"/></svg>');
        ed.ui.registry.addIcon("termicon", '<svg width="24" height="24" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h14V6zm2.3 3.7 1.4-1.4 3.7 3.7-3.7 3.7-1.4-1.4 2.3-2.3zM13 14h4v2h-4z"/></svg>');
        ed.ui.registry.addIcon("arsenal", '<svg width="24" height="24" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h9V6zm11 0v12h3V6z"/></svg>');

        ed.ui.registry.addToggleButton("winlinecode", {
          icon: "sourcecode", tooltip: "Code en ligne (Ctrl+E)",
          onAction: () => ed.execCommand("mceToggleFormat", false, "inlinecode"),
          onSetup: (api) => { api.setActive(ed.formatter.match("inlinecode")); const h = ed.formatter.formatChanged("inlinecode", (s) => api.setActive(s)); return () => h.unbind(); },
        });
        ed.addShortcut("meta+e", "Code en ligne", () => ed.execCommand("mceToggleFormat", false, "inlinecode"));

        const insertFlag = () => ed.insertContent(`<div class="flag-box">${esc($("#fFlag").value.trim() || "FLAG{...}")}</div><p></p>`);
        ed.ui.registry.addButton("wflag", { icon: "flagicon", tooltip: "Bloc flag", onAction: insertFlag });
        ed.ui.registry.addMenuItem("wflag", { icon: "flagicon", text: "Bloc flag", onAction: insertFlag });

        const insertTerm = () => {
          const sel = ed.selection.getContent({ format: "text" });
          ed.insertContent(`<pre class="terminal">${esc(sel || "$ commande")}</pre><p></p>`);
        };
        ed.ui.registry.addButton("wterminal", { icon: "termicon", tooltip: "Bloc terminal", onAction: insertTerm });
        ed.ui.registry.addMenuItem("wterminal", { icon: "termicon", text: "Bloc terminal", onAction: insertTerm });

        const callouts = [["info", "Info"], ["tip", "Astuce"], ["warn", "Attention"], ["danger", "Important"]];
        const insertCallout = (k) => ed.insertContent(`<div class="callout ${k}"><p>${ed.selection.getContent() || "Texte de l'encadré…"}</p></div><p></p>`);
        ed.ui.registry.addMenuButton("wcallouts", {
          icon: "info", tooltip: "Encadré (info, astuce, attention…)",
          fetch: (cb) => cb(callouts.map(([k, t]) => ({ type: "menuitem", text: t, onAction: () => insertCallout(k) }))),
        });
        ed.ui.registry.addNestedMenuItem("wcallouts", {
          icon: "info", text: "Encadré",
          getSubmenuItems: () => callouts.map(([k, t]) => ({ type: "menuitem", text: t, onAction: () => insertCallout(k) })),
        });

        const insertTpl = () => ed.insertContent(TEMPLATE);
        ed.ui.registry.addButton("wtemplate", { icon: "template", tooltip: "Insérer le modèle de writeup", onAction: insertTpl });
        ed.ui.registry.addMenuItem("wtemplate", { icon: "template", text: "Modèle de writeup", onAction: insertTpl });
        ed.ui.registry.addButton("warsenal", { icon: "arsenal", tooltip: "Arsenal : cheatsheet, encodeur, sommaire (Ctrl+J)", onAction: () => toggleDrawer() });
        ed.ui.registry.addMenuItem("wexport", { icon: "export", text: "Exporter en HTML", onAction: () => exportHTML() });
        ed.ui.registry.addMenuItem("wprint", { icon: "print", text: "Imprimer / PDF", onAction: () => printDoc() });

        ed.on("keydown", (e) => globalKeys(e, true));
        ed.on("input change undo redo ExecCommand SetAttrib ObjectResized", (ev) => {
          if (state.loading) return;
          // Pendant une sauvegarde, l'éditeur retouche lui-même les images (src, attributs internes) : ce n'est
          // pas une modification de l'utilisateur. Sans ce filtre, tout writeup contenant une image se
          // ré-enregistrait en boucle. La frappe (« input ») reste toujours prise en compte, et saveNow()
          // compare le contenu en fin de sauvegarde pour ne rien rater.
          if (state.uploading && /^(change|setattrib|execcommand)$/i.test(ev.type)) return;
          if (state.saving && /^setattrib$/i.test(ev.type)) return;
          markDirty(); refreshDocInfo();
        });
        ed.on("init", () => { applyPage(); resolve(ed); });
        ed.on("ResizeEditor ToggleToolbarDrawer", () => positionHandlesSoon());
      },
    });
  });
}

async function uploadImage(blobInfo, progress) {
  const blob = blobInfo.blob();
  // Pas de markDirty() ici : saveNow() attend déjà la fin des envois, et en mode navigateur
  // l'image reste en data: — la marquer « modifiée » à chaque passage relançait la sauvegarde en boucle.
  if (state.mode === "local") { progress(100); return `data:${blob.type || "image/png"};base64,${blobInfo.base64()}`; }
  const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": blob.type || "image/png" }, body: blob });
  const j = await r.json();
  if (!r.ok) throw { message: j.error || "Échec de l'envoi", remove: true };
  progress(100);
  return j.location;
}
const ed = () => tinymce.get("editor");

/* Recrée l'éditeur (nécessaire pour changer son habillage clair/sombre) sans perdre le contenu */
async function rebuildEditor() {
  const old = ed();
  if (!old) return;
  await flush();
  const content = state.current ? old.getContent() : "";
  state.loading = true;
  old.remove();
  initEditor();
  const e = await state.editorReady;
  if (state.current) { e.setContent(content); e.undoManager.clear(); e.undoManager.add(); }
  state.loading = false;
  applyPage();
  refreshDocInfo();
}

async function setTheme(t) {
  if (t !== "dark" && t !== "light") t = appTheme() === "dark" ? "light" : "dark";
  if (t === appTheme()) return;
  pref.set("theme", t);
  document.documentElement.dataset.theme = t;
  await rebuildEditor();
  applyPage();
}

/* =====================================================================
   Page : largeur & thème
   ===================================================================== */
function currentWidth() {
  const pw = state.current?.pageWidth;
  return pw === "" || pw == null ? Number(pref.get("pageWidth", 820)) : Number(pw);
}
function applyPage() {
  const e = ed();
  const w = currentWidth();
  const theme = pageTheme(), choice = pref.get("pageTheme2", "auto");
  if (e && e.getDoc()) {
    const root = e.getDoc().documentElement;
    root.classList.toggle("full", w === 0);
    root.classList.toggle("dark", theme === "dark");
    // même schéma de couleurs que le site, sinon le navigateur rend l'iframe opaque (plus de fond visible)
    root.style.colorScheme = appTheme();
    if (w) root.style.setProperty("--pw", w + "px");
  }
  $$("#widthSeg button").forEach((b) => b.classList.toggle("on", Number(b.dataset.w) === w));
  $$("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.t === choice));
  $("#widthRange").value = w || 1600;
  $("#widthLabel").textContent = w ? w + " px" : "100 %";
  positionHandlesSoon();
}
/* Poignées sur les bords de la page : redimensionnement à la souris */
function positionHandles() {
  const e = ed(), wrap = $("#editorWrap");
  const hs = $$(".page-handle");
  const iframe = e?.iframeElement;
  if (!state.current || !iframe || !e.getBody() || wrap.offsetParent === null) { hs.forEach((h) => (h.style.display = "none")); return; }
  const wr = wrap.getBoundingClientRect(), ir = iframe.getBoundingClientRect(), br = e.getBody().getBoundingClientRect();
  const full = currentWidth() === 0;
  hs.forEach((h) => {
    const x = ir.left - wr.left + (h.dataset.side === "l" ? br.left : br.right);
    h.style.display = full ? "none" : "block";
    h.style.left = x + "px";
    h.style.top = ir.top - wr.top + "px";
    h.style.height = ir.height + "px";
  });
}
const positionHandlesSoon = () => { positionHandles(); setTimeout(positionHandles, 260); };

function startPageResize(ev) {
  const e = ed(), handle = ev.currentTarget;
  ev.preventDefault();
  const iframe = e.iframeElement, body = e.getBody(), root = e.getDoc().documentElement;
  const ir = iframe.getBoundingClientRect(), br = body.getBoundingClientRect();
  const cs = e.getWin().getComputedStyle(body);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const cx = ir.left + (br.left + br.right) / 2;
  const maxW = Math.round(iframe.clientWidth - pad - 40);
  body.style.transition = "none";
  handle.classList.add("drag");
  document.body.classList.add("resizing");
  iframe.style.pointerEvents = "none";
  const label = $("#pageSize");
  let w = currentWidth();
  const move = (m) => {
    w = Math.round(Math.min(Math.max(2 * Math.abs(m.clientX - cx) - pad, 380), maxW) / 10) * 10;
    root.style.setProperty("--pw", w + "px");
    label.textContent = `${w} px`;
    label.classList.add("show");
    positionHandles();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    handle.classList.remove("drag");
    document.body.classList.remove("resizing");
    iframe.style.pointerEvents = "";
    body.style.transition = "";
    setTimeout(() => label.classList.remove("show"), 600);
    setWidth(w);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function setWidth(w) {
  pref.set("pageWidth", w);
  if (state.current) { state.current.pageWidth = w; markDirty(); }
  applyPage();
}
function setPageTheme(t) {
  pref.set("pageTheme2", t);
  applyPage();
}

/* =====================================================================
   Sidebar : liste & filtres
   ===================================================================== */
function renderCats() {
  const counts = {};
  state.list.forEach((w) => (counts[w.category] = (counts[w.category] || 0) + 1));
  const cats = CATEGORIES.filter(([c]) => counts[c]);
  $("#catFilter").innerHTML =
    `<button class="chip ${state.catFilter ? "" : "on"}" data-cat="">tout</button>` +
    cats.map(([c, col]) => `<button class="chip ${state.catFilter === c ? "on" : ""}" data-cat="${esc(c)}"><span class="dot" style="background:${col}"></span>${esc(c.toLowerCase())}<span class="n">${counts[c]}</span></button>`).join("");
}

function filtered() {
  const q = $("#search").value.trim();
  const st = $("#statusFilter").value;
  return state.list.filter((w) => {
    if (state.catFilter && w.category !== state.catFilter) return false;
    if (st && w.status !== st) return false;
    return !q || matchAll([w.title, w.ctf, w.category, w.flag, (w.tags || []).join(" "), w.text].join(" "), q);
  });
}

function renderList() {
  const items = filtered().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const groupBy = $("#groupBy").value;
  const n = state.list.length;
  const flags = state.list.filter((w) => w.status === "solved").length;
  $("#countLabel").textContent = `${n} writeup${n > 1 ? "s" : ""} · ${flags} flag${flags > 1 ? "s" : ""}${{ local: " · navigateur", cloud: " · ☁ cloud" }[state.mode] || ""}`;
  if (!items.length) {
    $("#list").innerHTML = `<div class="list-empty">${n ? "// aucun résultat" : "// vide — crée ton premier writeup"}</div>`;
    return;
  }
  const row = (w) => `
    <button class="item ${state.current?.id === w.id ? "active" : ""}" data-id="${w.id}">
      <span class="t"><span>${esc(w.title || "Sans titre")}</span>${w.pinned ? '<span class="star">★</span>' : ""}</span>
      <span class="s"><span class="st" style="background:${STATUS[w.status]?.color || "#475569"}" title="${STATUS[w.status]?.label || ""}"></span>
        <span class="cat-tag" style="--c:${catColor(w.category)}">${esc(groupBy === "category" ? w.ctf || "—" : w.category || "—")}</span>
        ${w.points ? `<span>${esc(w.points)}pts</span>` : ""}</span>
    </button>`;
  if (groupBy === "none") { $("#list").innerHTML = items.map(row).join(""); return; }
  const groups = new Map();
  items.forEach((w) => {
    const k = (groupBy === "ctf" ? w.ctf : w.category) || (groupBy === "ctf" ? "sans ctf" : "sans catégorie");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  });
  $("#list").innerHTML = [...groups].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([k, ws]) => `
    <div class="group ${state.closedGroups.has(k) ? "closed" : ""}" data-g="${esc(k)}">
      <button class="group-title">${icon("chev")}<span class="gn">${esc(k)}</span><span class="n">${ws.length}</span></button>
      <div class="group-items">${ws.map(row).join("")}</div>
    </div>`).join("");
}

function renderDatalist() {
  const ctfs = [...new Set(state.list.map((w) => w.ctf).filter(Boolean))].sort();
  $("#ctfList").innerHTML = ctfs.map((c) => `<option value="${esc(c)}">`).join("");
}

/* =====================================================================
   Tableau de bord
   ===================================================================== */
function typePrompt() {
  const el = $("#typed");
  const txt = "./stats --all";
  if (el.dataset.done) return;
  el.dataset.done = 1;
  let i = 0;
  const step = () => { el.textContent = txt.slice(0, ++i); if (i < txt.length) setTimeout(step, 45 + Math.random() * 60); };
  setTimeout(step, 250);
}

function relTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`;
  return "le " + new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function card(w) {
  const c = catColor(w.category);
  return `
    <button class="card" data-id="${w.id}" style="--c:${c}">
      <div class="row"><span class="badge">${esc(w.category || "—")}</span>
        <span class="cm"><span class="st" style="background:${STATUS[w.status]?.color || "#475569"}"></span>${STATUS[w.status]?.label || ""}${w.pinned ? ' <span style="color:var(--warn)">★</span>' : ""}</span></div>
      <div class="ct">${esc(w.title || "Sans titre")}</div>
      <div class="cm">${esc(w.ctf || "—")}${w.points ? " · " + esc(w.points) + " pts" : ""}${w.difficulty ? " · " + esc(w.difficulty.toLowerCase()) : ""}</div>
      ${(w.tags || []).length ? `<div class="cm">${w.tags.slice(0, 5).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="cm when">modifié ${relTime(w.updated)}</div>
    </button>`;
}

function renderDashboard() {
  const L = state.list;
  $("#emptyState").hidden = L.length > 0;
  $("#dashContent").hidden = !L.length;
  typePrompt();
  if (!L.length) return;

  const solved = L.filter((w) => w.status === "solved").length;
  const pts = L.reduce((s, w) => s + (Number(w.points) || 0), 0);
  const ctfs = new Set(L.map((w) => w.ctf).filter(Boolean)).size;
  const month = today().slice(0, 7);
  const thisMonth = L.filter((w) => (w.date || "").startsWith(month)).length;
  const pct = Math.round((solved / L.length) * 100);
  $("#stats").innerHTML = `
    <div class="panel stat"><span class="si">${icon("file")}</span><div class="v">${L.length}</div><div class="l">writeup${L.length > 1 ? "s" : ""}</div></div>
    <div class="panel stat hl"><span class="si">${icon("flag")}</span><div class="v accent">${solved}</div><div class="l">flag${solved > 1 ? "s" : ""} · ${pct}% résolus</div><div class="bar"><span style="width:${pct}%"></span></div></div>
    <div class="panel stat"><span class="si">${icon("trophy")}</span><div class="v">${pts.toLocaleString("fr-FR")}</div><div class="l">points cumulés</div></div>
    <div class="panel stat"><span class="si">${icon("globe")}</span><div class="v">${ctfs}</div><div class="l">ctf / plateformes</div></div>
    <div class="panel stat"><span class="si">${icon("cal")}</span><div class="v">${thisMonth}</div><div class="l">ce mois-ci</div></div>`;

  // Heatmap : 26 semaines, colonnes = semaines (lundi → dimanche)
  const byDay = {};
  L.forEach((w) => { const d = w.date || new Date(w.created).toISOString().slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
  const end = new Date(); end.setHours(12, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 7 * 25 - ((end.getDay() + 6) % 7));
  let cells = "", total = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10), n = byDay[k] || 0;
    total += n;
    cells += `<i data-l="${Math.min(n, 4)}" title="${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} : ${n} writeup${n > 1 ? "s" : ""}"></i>`;
  }
  $("#heat").innerHTML = cells;
  $("#heatInfo").textContent = `${total} sur 6 mois`;
  $("#heatRange").textContent = start.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) + " → aujourd'hui";

  const counts = {};
  L.forEach((w) => (counts[w.category || "Misc"] = (counts[w.category || "Misc"] || 0) + 1));
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  $("#catbars").innerHTML = cats.map(([c, n]) => `
    <button class="catbar" data-cat="${esc(c)}" title="Filtrer : ${esc(c)}"><span>${esc(c.toLowerCase())}</span>
      <span class="track"><span style="width:${(n / max) * 100}%;--c:${catColor(c)}"></span></span><b>${n}</b></button>`).join("");

  const tags = {};
  L.forEach((w) => (w.tags || []).forEach((t) => (tags[t] = (tags[t] || 0) + 1)));
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 18);
  $("#tagcloud").innerHTML = top.length ? top.map(([t, n]) => `<button class="tag" data-tag="${esc(t)}">#${esc(t)} <span style="opacity:.5">${n}</span></button>`).join("") : '<span class="muted sm mono">// ajoute des tags à tes writeups pour les voir ici</span>';

  const pinned = L.filter((w) => w.pinned);
  $("#pinnedWrap").hidden = !pinned.length;
  $("#pinned").innerHTML = pinned.map(card).join("");
  $("#recent").innerHTML = L.slice(0, 12).map(card).join("");
}

function renderAll() { renderCats(); renderList(); renderDatalist(); if (!state.current) renderDashboard(); }

/* =====================================================================
   Tags
   ===================================================================== */
function renderTags() {
  const box = $("#tagsBox");
  box.querySelectorAll(".tg").forEach((e) => e.remove());
  const input = $("#fTagInput");
  (state.current?.tags || []).forEach((t, i) => {
    const s = document.createElement("span");
    s.className = "tg";
    s.innerHTML = `#${esc(t)}<button title="Retirer" data-i="${i}">×</button>`;
    box.insertBefore(s, input);
  });
}
function addTag(raw) {
  const t = raw.trim().replace(/^#/, "").toLowerCase();
  if (!t || !state.current) return;
  state.current.tags = state.current.tags || [];
  if (!state.current.tags.includes(t)) state.current.tags.push(t);
  renderTags(); markDirty();
}

/* =====================================================================
   Ouverture / sauvegarde
   ===================================================================== */
const FIELDS = { title: "#fTitle", ctf: "#fCtf", category: "#fCategory", difficulty: "#fDifficulty", points: "#fPoints", date: "#fDate", status: "#fStatus", flag: "#fFlag" };

function updateCrumbs() {
  const s = (v, d) => norm(v).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || d;
  $("#crumbCtf").textContent = s($("#fCtf").value, "ctf");
  $("#crumbCat").textContent = s($("#fCategory").value, "misc");
  $("#pinBtn").classList.toggle("on", !!state.current?.pinned);
  const st = STATUS[$("#fStatus").value], pts = $("#fPoints").value, fl = $("#fFlag").value;
  $("#crumbMeta").innerHTML = `${st ? `<span><span class="st" style="background:${st.color}"></span> ${st.label}</span>` : ""}${pts ? `<span>${esc(pts)} pts</span>` : ""}${fl ? `<span class="fl">🚩 ${esc(fl.length > 28 ? fl.slice(0, 28) + "…" : fl)}</span>` : ""}`;
}
function setMeta(open, persist = true) {
  $("#meta").classList.toggle("collapsed", !open);
  $("#metaToggle").classList.toggle("on", open);
  if (persist) pref.set("metaOpen2", open);
  positionHandlesSoon();
}

const refreshDocInfo = debounce(() => {
  const e = ed();
  if (!e || !state.current || !e.getBody()) return;
  const body = e.getBody();
  const words = (e.getContent({ format: "text" }).match(/\S+/g) || []).length;
  const imgs = body.querySelectorAll("img").length;
  const code = body.querySelectorAll("pre").length;
  $("#docStats").innerHTML = `<span><b>${words}</b> mots</span><span><b>${Math.max(1, Math.round(words / 200))}</b> min</span><span><b>${code}</b> code</span><span><b>${imgs}</b> img</span>`;
  if (!$("#drawer").hidden && state.drawerTab === "toc") renderToc();
}, 350);

async function openWriteup(id, { push = true } = {}) {
  await flush();
  let doc;
  try { doc = await api.get(id); } catch { toast("Writeup introuvable"); return showHome(); }
  state.current = doc;
  for (const [k, sel] of Object.entries(FIELDS)) $(sel).value = doc[k] ?? "";
  if (!doc.status) $("#fStatus").value = "solved";
  if (!doc.category) $("#fCategory").value = "Web";
  renderTags();
  updateCrumbs();
  $("#dashboard").hidden = true;
  $("#editorView").hidden = false;
  document.body.classList.add("editing");
  const e = await state.editorReady;
  state.loading = true;
  e.setContent(doc.content || "");
  e.undoManager.clear();
  e.undoManager.add();
  state.loading = false;
  state.dirty = false;
  setSaveState("saved");
  applyPage();
  refreshDocInfo();
  renderList();
  if (!$("#drawer").hidden) openDrawer(state.drawerTab, { focus: false });
  if (push) history.pushState(null, "", "#/w/" + id);
  document.title = (doc.title || "Sans titre") + " · ctf://writeups";
  $("#sidebar").classList.remove("open");
  if (!doc.title) { setMeta(true, false); $("#fTitle").focus(); }
  positionHandlesSoon();
}

async function newWriteup(extra = {}) {
  await flush();
  const last = state.list[0];
  const doc = await api.create({
    title: "", ctf: state.current?.ctf || last?.ctf || "", category: state.catFilter || "Web",
    status: "solved", date: today(), content: TEMPLATE, tags: [], ...extra,
  });
  state.list.unshift({ ...doc, text: "" });
  renderAll();
  await openWriteup(doc.id);
  $("#fTitle").focus();
}

function collect() {
  const c = state.current;
  for (const [k, sel] of Object.entries(FIELDS)) c[k] = $(sel).value;
  c.title = c.title.trim();
  return c;
}

function setSaveState(s) {
  const el = $("#saveState");
  el.className = "save-state" + (s === "dirty" || s === "saving" ? " dirty" : s === "error" ? " err" : "");
  el.textContent = { saved: "enregistré", dirty: "modifié…", saving: "sauvegarde…", error: "erreur de sauvegarde" }[s];
}

function markDirty() {
  if (!state.current) return;
  state.dirty = true;
  setSaveState("dirty");
  clearTimeout(state.timer);
  state.timer = setTimeout(saveNow, 900);
}

async function saveNow() {
  clearTimeout(state.timer);
  if (!state.current || !state.dirty) return;
  if (state.saving) { await state.saving; if (!state.dirty) return; }
  const run = async () => {
    const e = ed();
    state.dirty = false;
    setSaveState("saving");
    try {
      state.uploading = true;
      try { await e.uploadImages(); } finally { state.uploading = false; }
      const c = collect();
      // Remplit le champ flag automatiquement depuis le bloc flag du writeup
      if (!c.flag) {
        const fb = [...e.getBody().querySelectorAll(".flag-box")].map((x) => x.textContent.trim()).find((t) => t && !t.includes("..."));
        if (fb) { c.flag = fb; $("#fFlag").value = fb; }
      }
      const body = { ...c, content: e.getContent() };
      delete body.id; delete body.created; delete body.updated; delete body.text;
      const meta = await api.update(c.id, body);
      c.updated = meta.updated;
      const i = state.list.findIndex((w) => w.id === c.id);
      if (i >= 0) state.list.splice(i, 1);
      state.list.unshift({ ...meta, text: e.getContent({ format: "text" }) });
      if (!state.dirty && state.current === c && e.getContent() !== body.content) markDirty(); // modifié pendant l'envoi
      if (!state.dirty) setSaveState("saved");
      document.title = (c.title || "Sans titre") + " · ctf://writeups";
      renderCats(); renderList(); renderDatalist();
    } catch (err) {
      state.dirty = true;
      setSaveState("error");
      toast("⚠ Sauvegarde impossible : " + err.message + " — le serveur tourne ?");
      state.timer = setTimeout(saveNow, 5000);
    }
  };
  state.saving = run();
  await state.saving;
  state.saving = null;
}
async function flush() { if (state.dirty) await saveNow(); else if (state.saving) await state.saving; }

async function showHome({ push = true } = {}) {
  await flush();
  state.current = null;
  $("#editorView").hidden = true;
  $("#dashboard").hidden = false;
  document.body.classList.remove("editing");
  document.title = "ctf://writeups";
  if (push) history.pushState(null, "", "#/");
  renderList(); renderDashboard();
  if (!$("#drawer").hidden && state.drawerTab !== "tools") openDrawer(state.drawerTab, { focus: false });
  $("#sidebar").classList.remove("open");
}

async function deleteCurrent() {
  const c = state.current;
  if (!c) return;
  const ok = await confirmModal({ title: "Supprimer ce writeup ?", text: `« ${c.title || "Sans titre"} » ${{ server: "sera déplacé dans data/corbeille/ (récupérable).", cloud: "sera déplacé dans le dossier trash/ de ton stockage (récupérable)." }[state.mode] || "sera retiré de ce navigateur. Pense à faire un backup avant si tu veux le garder."}`, ok: "Supprimer", danger: true });
  if (!ok) return;
  clearTimeout(state.timer); state.dirty = false;
  await api.remove(c.id);
  state.list = state.list.filter((w) => w.id !== c.id);
  state.current = null;
  renderAll(); showHome();
  toast({ server: "Writeup supprimé → data/corbeille", cloud: "Writeup supprimé → trash/" }[state.mode] || "Writeup supprimé");
}

async function duplicateCurrent() {
  if (!state.current) return;
  await flush();
  const c = collect();
  const { id, created, updated, text, ...rest } = c;
  await newWriteup({ ...rest, pinned: false, title: (c.title || "Sans titre") + " (copie)", content: ed().getContent(), tags: [...(c.tags || [])] });
  toast("Writeup dupliqué");
}

/* =====================================================================
   Export
   ===================================================================== */
const toDataURL = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

async function inlineImages(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  await Promise.all([...div.querySelectorAll("img")].map(async (img) => {
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("/images/")) return;
    try { img.src = await toDataURL(await (await fetch(src)).blob()); } catch {}
  }));
  return div.innerHTML;
}

async function fontCSS() {
  // Intègre les polices dans l'export pour qu'il soit autonome
  try {
    let css = await (await fetch("/vendor/fonts/fonts.css")).text();
    const urls = [...new Set((css.match(/url\(([^)]+)\)/g) || []).map((u) => u.slice(4, -1)))];
    for (const u of urls) css = css.split(`url(${u})`).join(`url(${await toDataURL(await (await fetch("/vendor/fonts/" + u)).blob())})`);
    return css;
  } catch { return ""; }
}

function buildDocHTML(content, { forPrint = false, fonts = "" } = {}) {
  const c = collect();
  const metaBits = [c.ctf, c.category, c.difficulty, c.points && c.points + " pts", c.date && new Date(c.date).toLocaleDateString("fr-FR")].filter(Boolean);
  const theme = forPrint ? "" : pageTheme();
  return `<!doctype html><html lang="fr" class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.title || "Writeup")}</title><style>${fonts}${CONTENT_CSS}
html{background:#eef1f5}html.dark{background:#06080b}
.wh{margin-bottom:2.2em;padding-bottom:1.4em;border-bottom:1px solid rgba(127,127,127,.25)}.wh .k{font:12px "JetBrains Mono",monospace;color:#00b97d;margin-bottom:.4em}
.wh h1{margin:0 0 .35em;font-size:2.2em;letter-spacing:-.8px}.wh h1::before{content:none}.wh .m{color:#6b7785;font-size:.9em;font-family:"JetBrains Mono",monospace}.wh .t{margin-top:.7em}
.wh .t span{display:inline-block;font:.78em "JetBrains Mono",monospace;padding:.15em .6em;margin:0 .35em .35em 0;border-radius:6px;background:rgba(0,229,155,.1);color:#00b97d;border:1px solid rgba(0,229,155,.3)}</style></head>
<body><header class="wh"><div class="k">~/writeups/${esc(slug(c.ctf || "ctf"))}/</div><h1>${esc(c.title || "Sans titre")}</h1><div class="m">${metaBits.map(esc).join(" · ")}</div>
${(c.tags || []).length ? `<div class="t">${c.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}</header>
${content}</body></html>`;
}

const slug = (s) => norm(s || "writeup").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportHTML() {
  if (!state.current) return toast("Ouvre un writeup d'abord");
  await flush();
  const html = buildDocHTML(await inlineImages(ed().getContent()), { fonts: await fontCSS() });
  download(`${slug(collect().ctf)}_${slug(collect().title)}.html`, html, "text/html");
  toast("Export HTML téléchargé (images + polices incluses)");
}

async function printDoc() {
  if (!state.current) return toast("Ouvre un writeup d'abord");
  await flush();
  const w = window.open("", "_blank");
  if (!w) return toast("Autorise les pop-ups pour imprimer");
  w.document.write(buildDocHTML(ed().getContent(), { forPrint: true })
    .replace("<style>", '<link rel="stylesheet" href="/vendor/fonts/fonts.css"><style>')
    .replace("</body>", "<script>window.onload=()=>setTimeout(()=>print(),400)<\/script></body>"));
  w.document.close();
}

function htmlToMarkdown(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  const inline = (n) => [...n.childNodes].map(walkInline).join("");
  function walkInline(n) {
    if (n.nodeType === 3) return n.textContent.replace(/ /g, " ");
    if (n.nodeType !== 1) return "";
    const t = n.tagName.toLowerCase(), c = () => inline(n);
    switch (t) {
      case "strong": case "b": return `**${c()}**`;
      case "em": case "i": return `*${c()}*`;
      case "s": case "del": case "strike": return `~~${c()}~~`;
      case "code": return "`" + n.textContent + "`";
      case "a": return `[${c()}](${n.getAttribute("href")})`;
      case "img": { const s = n.getAttribute("src") || ""; return `![${n.alt || ""}](${s.startsWith("/") ? location.origin + s : s})`; }
      case "br": return "  \n";
      case "kbd": return `<kbd>${c()}</kbd>`;
      default: return c();
    }
  }
  const quote = (n) => [...n.childNodes].map((x) => block(x)).join("").trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";
  function block(n, depth = 0) {
    if (n.nodeType === 3) return n.textContent.trim() ? n.textContent + "\n\n" : "";
    if (n.nodeType !== 1) return "";
    const t = n.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return "#".repeat(+t[1]) + " " + inline(n).trim() + "\n\n";
    if (t === "p") return inline(n).trim() + "\n\n";
    if (t === "pre") {
      const lang = (n.className.match(/language-([\w-]+)/) || [, n.classList.contains("terminal") ? "console" : ""])[1];
      return "```" + lang + "\n" + n.textContent.replace(/\n$/, "") + "\n```\n\n";
    }
    if (t === "blockquote") return quote(n);
    if (t === "ul" || t === "ol") {
      return [...n.children].map((li, i) => {
        const sub = [...li.childNodes].filter((x) => x.nodeType === 1 && /^(ul|ol)$/i.test(x.tagName));
        const txt = [...li.childNodes].filter((x) => !sub.includes(x)).map((x) => (x.nodeType === 1 && x.tagName === "P" ? inline(x) : walkInline(x))).join("").trim();
        return "  ".repeat(depth) + (t === "ol" ? `${i + 1}. ` : "- ") + txt + "\n" + sub.map((s) => block(s, depth + 1)).join("").replace(/\n\n$/, "\n");
      }).join("") + (depth ? "" : "\n");
    }
    if (t === "div" && n.classList.contains("flag-box")) return "> 🚩 `" + n.textContent.trim() + "`\n\n";
    if (t === "div" && n.classList.contains("callout")) return quote(n);
    if (t === "hr") return "---\n\n";
    if (t === "table") {
      const rows = [...n.querySelectorAll("tr")].map((r) => [...r.children].map((c) => inline(c).trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const head = rows.shift();
      return "| " + head.join(" | ") + " |\n|" + head.map(() => " --- |").join("") + "\n" + rows.map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n\n";
    }
    if (t === "figure") return [...n.childNodes].map(walkInline).join(" ").trim() + "\n\n";
    if (["div", "section", "details", "summary"].includes(t)) return [...n.childNodes].map((x) => block(x)).join("");
    return inline(n) + "\n\n";
  }
  return [...div.childNodes].map((n) => block(n)).join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function exportMD() {
  if (!state.current) return toast("Ouvre un writeup d'abord");
  await flush();
  const c = collect();
  const head = `# ${c.title || "Sans titre"}\n\n` + [c.ctf && `**CTF :** ${c.ctf}`, c.category && `**Catégorie :** ${c.category}`, c.difficulty && `**Difficulté :** ${c.difficulty}`, c.points && `**Points :** ${c.points}`, c.date && `**Date :** ${c.date}`, c.flag && `**Flag :** \`${c.flag}\``].filter(Boolean).join("  \n") + ((c.tags || []).length ? `  \n**Tags :** ${c.tags.map((t) => "#" + t).join(" ")}` : "") + "\n\n---\n\n";
  download(`${slug(c.ctf)}_${slug(c.title)}.md`, head + htmlToMarkdown(ed().getContent()), "text/markdown");
  toast("Export Markdown téléchargé");
}

/* =====================================================================
   Arsenal (drawer) : cheatsheet / encodeur / sommaire
   ===================================================================== */
function openDrawer(tab = state.drawerTab, { focus = true } = {}) {
  state.drawerTab = tab;
  pref.set("drawerTab", tab);
  pref.set("drawerOpen", true);
  $("#drawer").hidden = false;
  $("#drawerBtn").classList.add("on");
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $$(".pane").forEach((p) => (p.hidden = p.dataset.pane !== tab));
  if (tab === "cheat") { renderCheat(); if (focus) setTimeout(() => $("#cheatSearch").focus(), 30); }
  if (tab === "tools" && focus) setTimeout(() => $("#tIn").focus(), 30);
  if (tab === "toc") renderToc();
}
function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawerBtn").classList.remove("on");
  pref.set("drawerOpen", false);
}
function toggleDrawer(tab) {
  if (!$("#drawer").hidden && (!tab || tab === state.drawerTab)) closeDrawer();
  else openDrawer(tab);
}

/* ---- Cheatsheet ---- */
function allCommands() {
  return [
    ...state.custom.map((c) => ({ ...c, custom: true })),
    ...window.CHEATSHEET.map(([cat, title, cmd, tags]) => ({ cat, title, cmd, tags })),
  ];
}
const subst = (cmd) => cmd.replace(/\{([A-Z]+)\}/g, (m, k) => (state.vars[k] ? state.vars[k] : m));

function highlightCmd(cmd) {
  const tokens = (s) => s.split(/(\{[A-Z]+\})/).map((p) => {
    const m = p.match(/^\{([A-Z]+)\}$/);
    if (m && state.vars[m[1]]) return `<span class="v" title="{${m[1]}}">${esc(state.vars[m[1]])}</span>`;
    return esc(p);
  }).join("");
  return cmd.split("\n").map((line) => {
    const m = line.match(/^(|.*?\s)(#\s.*)$/);
    if (m) return tokens(m[1]) + `<span class="c">${tokens(m[2])}</span>`;
    return tokens(line);
  }).join("\n");
}

function renderCheatCats() {
  const counts = {};
  allCommands().forEach((c) => (counts[c.cat] = (counts[c.cat] || 0) + 1));
  const cats = Object.keys(window.CHEAT_CATS).filter((c) => counts[c]);
  const extra = Object.keys(counts).filter((c) => !window.CHEAT_CATS[c]);
  $("#cheatCats").innerHTML = `<button class="chip ${state.cheatCat ? "" : "on"}" data-c="">tout</button>` +
    (state.custom.length ? `<button class="chip ${state.cheatCat === "__mine" ? "on" : ""}" data-c="__mine">★ perso<span class="n">${state.custom.length}</span></button>` : "") +
    [...cats, ...extra].map((c) => `<button class="chip ${state.cheatCat === c ? "on" : ""}" data-c="${esc(c)}"><span class="dot" style="background:${window.CHEAT_CATS[c] || "#94a3b8"}"></span>${esc(c.toLowerCase())}<span class="n">${counts[c]}</span></button>`).join("");
}

function renderVars() {
  $("#vars").innerHTML = Object.keys(window.CHEAT_VARS).map((k) => `<label><span>${k}</span><input data-var="${k}" value="${esc(state.vars[k])}" spellcheck="false"></label>`).join("");
  updateVarsSummary();
}
const updateVarsSummary = () => ($("#varsSummary").textContent = `${state.vars.LHOST}:${state.vars.LPORT} → ${state.vars.RHOST}`);

function filteredCommands() {
  const q = $("#cheatSearch").value.trim();
  return allCommands().filter((c) => {
    if (state.cheatCat === "__mine" && !c.custom) return false;
    if (state.cheatCat && state.cheatCat !== "__mine" && c.cat !== state.cheatCat) return false;
    return !q || matchAll(`${c.cat} ${c.title} ${c.cmd} ${c.tags || ""}`, q);
  });
}

function renderCheat() {
  renderCheatCats();
  const items = filteredCommands();
  state.cheatView = items;
  $("#cheatCount").textContent = `${items.length} commande${items.length > 1 ? "s" : ""}`;
  const canInsert = !!state.current;
  $("#cheatList").innerHTML = items.length ? items.map((c, i) => `
    <div class="cmd" data-i="${i}">
      <div class="cmd-head">
        <span class="tt">${esc(c.title)}</span>
        <span class="badge" style="--c:${window.CHEAT_CATS[c.cat] || "#94a3b8"}">${esc(c.custom ? "★ " + c.cat : c.cat)}</span>
        <span class="cmd-acts">
          <button class="icon-btn sm" data-a="copy" title="Copier">${icon("copy")}</button>
          ${canInsert ? `<button class="icon-btn sm" data-a="insert" title="Insérer dans le writeup">${icon("insert")}</button>` : ""}
          ${c.custom ? `<button class="icon-btn sm" data-a="del" title="Supprimer">${icon("trash")}</button>` : ""}
        </span>
      </div>
      <pre title="Cliquer pour copier">${highlightCmd(c.cmd)}</pre>
    </div>`).join("") : `<div class="list-empty">// aucune commande — ajoute la tienne avec « Ma commande »</div>`;
}
const renderCheatSoon = debounce(renderCheat, 120);

function insertCommand(cmd) {
  const e = ed();
  if (!state.current || !e) return toast("Ouvre un writeup pour insérer");
  const text = subst(cmd);
  const isPy = /^(from \w|import \w|def \w|print\()/m.test(text);
  e.focus();
  e.insertContent(isPy ? `<pre class="language-python"><code>${esc(text)}</code></pre><p></p>` : `<pre class="terminal">${esc(text)}</pre><p></p>`);
  toast("Inséré dans le writeup");
}

async function saveCustom() {
  try { await api.saveCheat(state.custom); } catch (e) { toast("⚠ " + e.message); }
}

/* ---- Encodeur ---- */
function renderOps() {
  const groups = {};
  window.TOOL_OPS.forEach((o) => (groups[o.group] = groups[o.group] || []).push(o));
  $("#ops").innerHTML = Object.entries(groups).map(([g, ops]) => `<div class="grp"><span>${esc(g)}</span>${ops.map((o) => `<button class="op ${state.lastOp === o.id ? "last" : ""}" data-op="${o.id}">${esc(o.label).replace(/ →$/, ' <i>enc</i>').replace(/ ←$/, ' <i>dec</i>')}</button>`).join("")}</div>`).join("");
}
async function runOp(id) {
  const op = window.TOOL_OPS.find((o) => o.id === id);
  if (!op) return;
  const name = op.label.replace(/ →$/, " (enc)").replace(/ ←$/, " (dec)");
  state.lastOp = id;
  const out = $("#tOut");
  try {
    const r = String(await op.run($("#tIn").value, $("#tKey").value));
    out.textContent = r;
    out.classList.remove("err");
    $("#outLbl").textContent = `sortie · ${name} · ${[...r].length} car.`;
  } catch (e) {
    out.textContent = "✗ " + (e.message || e);
    out.classList.add("err");
    $("#outLbl").textContent = `sortie · ${name}`;
  }
  $$(".op").forEach((b) => b.classList.toggle("last", b.dataset.op === id));
}

/* ---- Sommaire ---- */
function renderToc() {
  const e = ed();
  if (!state.current || !e?.getBody()) { $("#toc").innerHTML = '<div class="empty-toc">// ouvre un writeup pour voir son plan</div>'; return; }
  const hs = [...e.getBody().querySelectorAll("h1,h2,h3")];
  $("#toc").innerHTML = hs.length ? hs.map((h, i) => `<a href="#" data-h="${i}" class="l${h.tagName[1]}">${esc(h.textContent.trim() || "(titre vide)")}</a>`).join("") : '<div class="empty-toc">// ajoute des titres (H1–H3) pour générer le sommaire</div>';
}

/* =====================================================================
   Palette de commandes (Ctrl+K), modales
   ===================================================================== */
const ACTIONS = [
  { t: "Nouveau writeup", i: "plus", k: "Ctrl Alt N", run: () => newWriteup() },
  { t: "Accueil / tableau de bord", i: "home", run: () => showHome() },
  { t: "Ouvrir la cheatsheet", i: "term", k: "Ctrl J", run: () => openDrawer("cheat") },
  { t: "Ouvrir l'encodeur / décodeur", i: "code", k: "Ctrl Maj E", run: () => openDrawer("tools") },
  { t: "Sommaire du writeup", i: "list", run: () => openDrawer("toc") },
  { t: "Mode focus", i: "focus", k: "Ctrl Maj F", run: () => toggleFocus() },
  { t: "Thème clair / sombre", i: "sun", run: () => setTheme() },
  { t: "Mettre en favori / retirer", i: "star", need: true, run: () => togglePin() },
  { t: "Exporter en HTML", i: "file", need: true, run: () => exportHTML() },
  { t: "Exporter en Markdown", i: "file", need: true, run: () => exportMD() },
  { t: "Imprimer / PDF", i: "print", k: "Ctrl P", need: true, run: () => printDoc() },
  { t: "Dupliquer le writeup", i: "dup", need: true, run: () => duplicateCurrent() },
  { t: "Télécharger une sauvegarde", i: "download", run: () => backup() },
  { t: "Importer une sauvegarde (.json)", i: "upload", run: () => $("#importFile").click() },
  { t: "Raccourcis clavier", i: "help", run: () => showHelp() },
  { t: "Se déconnecter", i: "x", cloud: true, run: () => logout() },
];

function makeOverlay(html) {
  closeOverlay();
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.id = "overlay";
  ov.innerHTML = html;
  document.body.appendChild(ov);
  return ov;
}
function closeOverlay() { $("#overlay")?.remove(); }

function openPalette(initial = "") {
  const ov = makeOverlay(`
    <div class="palette" role="dialog">
      <div class="palette-in"><span class="gt">❯</span><input id="pIn" placeholder="Chercher un writeup, une commande (nmap, suid…), une action…" autocomplete="off" spellcheck="false"><kbd>Échap</kbd></div>
      <div class="palette-list" id="pList"></div>
      <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir / copier</span><span><kbd>Maj</kbd>+<kbd>Entrée</kbd> insérer la commande</span></div>
    </div>`);
  const input = $("#pIn");
  let items = [], sel = 0;
  const highlight = () => {
    $$(".p-item").forEach((b) => b.classList.toggle("sel", +b.dataset.i === sel));
    $(`.p-item[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    const q = input.value.trim();
    const acts = ACTIONS.filter((a) => (!a.need || state.current) && (!a.cloud || state.mode === "cloud") && (!q || matchAll(a.t, q))).map((a) => ({ type: "action", ...a }));
    const ws = state.list.filter((w) => !q || matchAll([w.title, w.ctf, w.category, (w.tags || []).join(" "), w.text].join(" "), q))
      .slice(0, q ? 8 : 5).map((w) => ({ type: "writeup", w }));
    const cmds = q ? allCommands().filter((c) => matchAll(`${c.cat} ${c.title} ${c.cmd} ${c.tags || ""}`, q)).slice(0, 8).map((c) => ({ type: "cmd", c })) : [];
    items = [];
    let html = "";
    const order = q ? [["Writeups", ws], ["Commandes", cmds], ["Actions", acts]] : [["Actions", acts], ["Writeups récents", ws]];
    for (const [title, arr] of order) {
      if (!arr.length) continue;
      html += `<div class="p-sec">${title}</div>`;
      for (const it of arr) {
        const i = items.push(it) - 1;
        if (it.type === "action") html += `<button class="p-item" data-i="${i}">${icon(it.i)}<span class="main-t">${esc(it.t)}</span>${it.k ? `<kbd>${it.k}</kbd>` : ""}</button>`;
        else if (it.type === "writeup") html += `<button class="p-item" data-i="${i}">${icon("file")}<span class="main-t">${esc(it.w.title || "Sans titre")}</span><span class="sub">${esc([it.w.ctf, it.w.category].filter(Boolean).join(" · "))}</span></button>`;
        else html += `<button class="p-item" data-i="${i}">${icon("term")}<span class="main-t">${esc(it.c.title)}</span><span class="sub">${esc(subst(it.c.cmd).split("\n")[0])}</span></button>`;
      }
    }
    $("#pList").innerHTML = html || '<div class="list-empty">// rien trouvé</div>';
    sel = Math.min(sel, Math.max(0, items.length - 1));
    highlight();
  };
  const exec = (i, shift) => {
    const it = items[i];
    if (!it) return;
    closeOverlay();
    if (it.type === "action") it.run();
    else if (it.type === "writeup") openWriteup(it.w.id);
    else if (shift) insertCommand(it.c.cmd);
    else copyText(subst(it.c.cmd), "Commande copiée");
  };
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", (e) => {
    const n = Math.max(items.length, 1);
    if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % n; highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + n) % n; highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); exec(sel, e.shiftKey); }
    else if (e.key === "Escape") { e.stopPropagation(); closeOverlay(); }
  });
  $("#pList").addEventListener("mousemove", (e) => { const b = e.target.closest(".p-item"); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; highlight(); } });
  $("#pList").addEventListener("click", (e) => { const b = e.target.closest(".p-item"); if (b) exec(+b.dataset.i, e.shiftKey); });
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeOverlay(); });
  input.value = initial;
  render();
  input.focus();
}

function confirmModal({ title, text, ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const ov = makeOverlay(`<div class="modal"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="acts"><button class="btn" data-r="0">Annuler</button><button class="${danger ? "btn-danger" : "btn-primary"}" data-r="1">${esc(ok)}</button></div></div>`);
    const done = (v) => { ov.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1"); else if (e.target === ov) done(false); });
    $("[data-r='1']", ov).focus();
  });
}

function showHelp() {
  const rows = [
    ["Ctrl K", "Palette : writeups, commandes, actions"], ["/", "Filtrer la liste des writeups"],
    ["Ctrl J", "Arsenal : cheatsheet"], ["Ctrl Maj E", "Encodeur / décodeur"],
    ["Ctrl Alt N", "Nouveau writeup"], ["Ctrl S", "Enregistrer (automatique de toute façon)"],
    ["Ctrl Maj F", "Mode focus"], ["Ctrl P", "Imprimer / PDF"],
    ["Ctrl E", "Code en ligne (dans l'éditeur)"], ["Ctrl V", "Coller une capture d'écran"],
    ["Échap", "Fermer palette / panneau / mode focus"],
  ];
  const ov = makeOverlay(`<div class="modal wide"><h3>Raccourcis clavier</h3><p>Ils fonctionnent aussi pendant que tu écris dans l'éditeur.</p>
    <div class="help-grid">${rows.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join("")}</div>
    <div class="acts"><button class="btn-primary" data-close>OK</button></div></div>`);
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) closeOverlay(); });
  $("[data-close]", ov).focus();
}

/* =====================================================================
   Focus, favori
   ===================================================================== */
function toggleFocus(force) {
  const on = $("#app").classList.toggle("focus", force);
  $("#focusBtn").classList.toggle("on", on);
  pref.set("focus", on);
  positionHandlesSoon();
}
function togglePin() {
  if (!state.current) return;
  state.current.pinned = !state.current.pinned;
  $("#pinBtn").classList.toggle("on", state.current.pinned);
  toast(state.current.pinned ? "★ Ajouté aux favoris" : "Retiré des favoris");
  markDirty();
}

/* =====================================================================
   Raccourcis globaux (appelés aussi depuis l'iframe de l'éditeur)
   ===================================================================== */
function globalKeys(e, fromEditor = false) {
  const mod = e.ctrlKey || e.metaKey;
  const k = (e.key || "").toLowerCase();
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && !e.shiftKey && !e.altKey && k === "k") { stop(); return openPalette(); }
  if (mod && !e.shiftKey && k === "j") { stop(); return toggleDrawer("cheat"); }
  if (mod && e.shiftKey && k === "e") { stop(); return toggleDrawer("tools"); }
  if (mod && e.shiftKey && k === "f") { stop(); return toggleFocus(); }
  if (mod && !e.shiftKey && k === "s") { stop(); saveNow(); return toast("✔ Enregistré"); }
  if (mod && e.altKey && k === "n") { stop(); return newWriteup(); }
  if (mod && !e.shiftKey && !e.altKey && k === "p" && state.current) { stop(); return printDoc(); }
  if (fromEditor) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !$("#overlay")) { stop(); $("#search").focus(); return; }
  if (e.key === "Escape") {
    if ($("#overlay")) return closeOverlay();
    if (!$("#moreMenu").hidden || !$("#pageMenu").hidden) { $("#moreMenu").hidden = true; $("#pageMenu").hidden = true; return; }
    if ($("#sidebar").classList.contains("open")) return $("#sidebar").classList.remove("open");
    if (document.activeElement === $("#search")) { $("#search").value = ""; renderList(); $("#search").blur(); return; }
    if (!$("#drawer").hidden) return closeDrawer();
    if ($("#app").classList.contains("focus")) return toggleFocus(false);
  }
}

/* =====================================================================
   Liaison des événements
   ===================================================================== */
function bind() {
  $("#fCategory").innerHTML = CATEGORIES.map(([c]) => `<option>${esc(c)}</option>`).join("");
  $("#customForm [name=cat]").innerHTML = ["Perso", ...Object.keys(window.CHEAT_CATS)].map((c) => `<option>${esc(c)}</option>`).join("");

  ["#newBtn", "#newBtn2", "#newBtn3"].forEach((s) => ($(s).onclick = () => newWriteup()));
  $("#brand").onclick = () => showHome();
  $("#paletteBtn").onclick = () => openPalette();
  $("#helpBtn").onclick = () => showHelp();
  $("#themeBtn").onclick = () => setTheme();
  $("#scrim").onclick = () => $("#sidebar").classList.remove("open");
  $("#backupBtn").onclick = (e) => { e.preventDefault(); backup(); };
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); };
  $("#search").oninput = renderList;
  $("#groupBy").value = pref.get("groupBy", "ctf");
  $("#groupBy").onchange = () => { pref.set("groupBy", $("#groupBy").value); renderList(); };
  $("#statusFilter").onchange = renderList;

  $("#catFilter").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.catFilter = b.dataset.cat; pref.set("catFilter", state.catFilter); renderCats(); renderList();
  };
  $("#list").onclick = (e) => {
    const g = e.target.closest(".group-title");
    if (g) {
      const k = g.parentElement.dataset.g;
      state.closedGroups.has(k) ? state.closedGroups.delete(k) : state.closedGroups.add(k);
      pref.set("closedGroups", [...state.closedGroups]);
      g.parentElement.classList.toggle("closed");
      return;
    }
    const it = e.target.closest(".item"); if (it) openWriteup(it.dataset.id);
  };
  $("#dashboard").addEventListener("click", (e) => {
    const c = e.target.closest(".card"); if (c) return openWriteup(c.dataset.id);
    const cb = e.target.closest(".catbar");
    if (cb) { state.catFilter = cb.dataset.cat; pref.set("catFilter", state.catFilter); renderCats(); renderList(); return; }
    const t = e.target.closest("[data-tag]");
    if (t) { $("#search").value = t.dataset.tag; renderList(); $("#search").focus(); }
  });
  $$("[data-open-drawer]").forEach((b) => (b.onclick = () => openDrawer(b.dataset.openDrawer)));

  for (const sel of Object.values(FIELDS)) { $(sel).addEventListener("input", markDirty); $(sel).addEventListener("input", updateCrumbs); }
  $("#crumbs").onclick = () => setMeta($("#meta").classList.contains("collapsed"));
  $("#fTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ed().focus(); } });

  $("#fTagInput").addEventListener("keydown", (e) => {
    const inp = e.target;
    if (["Enter", ",", "Tab"].includes(e.key) && inp.value.trim()) { e.preventDefault(); addTag(inp.value); inp.value = ""; }
    else if (e.key === "Backspace" && !inp.value && state.current?.tags?.length) { state.current.tags.pop(); renderTags(); markDirty(); }
  });
  $("#fTagInput").addEventListener("blur", (e) => { if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ""; } });
  $("#tagsBox").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) { state.current.tags.splice(+b.dataset.i, 1); renderTags(); markDirty(); } else $("#fTagInput").focus();
  });
  $("#copyFlag").onclick = (e) => { e.preventDefault(); if ($("#fFlag").value) copyText($("#fFlag").value, "Flag copié 🚩"); };

  setMeta(pref.get("metaOpen2", false), false);
  $("#metaToggle").onclick = () => setMeta($("#meta").classList.contains("collapsed"));
  $("#pinBtn").onclick = togglePin;
  $("#focusBtn").onclick = () => toggleFocus();
  $("#drawerBtn").onclick = () => toggleDrawer();
  if (pref.get("focus", false)) toggleFocus(true);

  $("#widthSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) setWidth(Number(b.dataset.w)); };
  $("#widthRange").oninput = (e) => setWidth(Number(e.target.value) >= 1600 ? 0 : Number(e.target.value));
  $("#themeSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) setPageTheme(b.dataset.t); };

  $("#moreBtn").onclick = (e) => { e.stopPropagation(); $("#pageMenu").hidden = true; $("#moreMenu").hidden = !$("#moreMenu").hidden; };
  $("#pageBtn").onclick = (e) => { e.stopPropagation(); $("#moreMenu").hidden = true; $("#pageMenu").hidden = !$("#pageMenu").hidden; };
  $("#pageMenu").onclick = (e) => e.stopPropagation();
  document.addEventListener("click", () => { $("#moreMenu").hidden = true; $("#pageMenu").hidden = true; });

  // Poignées de la page + redimensionnement de la barre latérale
  $$(".page-handle").forEach((h) => h.addEventListener("mousedown", startPageResize));
  new ResizeObserver(() => positionHandles()).observe($("#editorWrap"));
  window.addEventListener("resize", positionHandles);
  document.documentElement.style.setProperty("--side-w", pref.get("sideW", 296) + "px");
  $("#sideResize").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.classList.add("drag");
    $$("iframe").forEach((f) => (f.style.pointerEvents = "none"));
    const width = (x) => Math.round(Math.min(Math.max(x, 220), 520));
    const move = (ev) => document.documentElement.style.setProperty("--side-w", width(ev.clientX) + "px");
    const up = (ev) => {
      handle.classList.remove("drag");
      $$("iframe").forEach((f) => (f.style.pointerEvents = ""));
      pref.set("sideW", width(ev.clientX));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  $("#moreMenu").onclick = (e) => {
    const act = e.target.closest("button")?.dataset.act;
    $("#moreMenu").hidden = true;
    ({ print: printDoc, html: exportHTML, md: exportMD, dup: duplicateCurrent, del: deleteCurrent })[act]?.();
  };

  $$("[data-toggle-sidebar]").forEach((b) => (b.onclick = () => $("#sidebar").classList.toggle("open")));

  // ---- Drawer (onglets + redimensionnement) ----
  $("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) openDrawer(b.dataset.tab); };
  $("#drawerClose").onclick = closeDrawer;
  document.documentElement.style.setProperty("--drawer-w", pref.get("drawerW", 440) + "px");
  $("#drawerResize").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.classList.add("drag");
    $$("iframe").forEach((f) => (f.style.pointerEvents = "none"));
    const width = (x) => Math.round(Math.min(Math.max(window.innerWidth - x, 320), window.innerWidth * 0.7));
    const move = (ev) => document.documentElement.style.setProperty("--drawer-w", width(ev.clientX) + "px");
    const up = (ev) => {
      handle.classList.remove("drag");
      $$("iframe").forEach((f) => (f.style.pointerEvents = ""));
      pref.set("drawerW", width(ev.clientX));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  // ---- Cheatsheet ----
  $("#cheatSearch").addEventListener("input", debounce(renderCheat, 80));
  $("#cheatCats").onclick = (e) => { const b = e.target.closest(".chip"); if (b) { state.cheatCat = b.dataset.c; renderCheat(); } };
  $("#varsToggle").onclick = () => { $("#vars").hidden = !$("#vars").hidden; $("#varsToggle").classList.toggle("open", !$("#vars").hidden); };
  $("#vars").addEventListener("input", (e) => {
    const k = e.target.dataset.var; if (!k) return;
    state.vars[k] = e.target.value;
    pref.set("vars", state.vars);
    updateVarsSummary();
    renderCheatSoon();
  });
  $("#cheatList").addEventListener("click", async (e) => {
    const box = e.target.closest(".cmd"); if (!box) return;
    const c = state.cheatView[+box.dataset.i];
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "insert") return insertCommand(c.cmd);
    if (a === "del") {
      if (!(await confirmModal({ title: "Supprimer cette commande ?", text: c.title, ok: "Supprimer", danger: true }))) return;
      state.custom = state.custom.filter((x) => x.id !== c.id);
      await saveCustom(); renderCheat(); return;
    }
    if (a === "copy" || e.target.closest("pre")) {
      if (!a && window.getSelection().toString()) return; // laisse sélectionner une partie de la commande
      box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
      copyText(subst(c.cmd), "Commande copiée");
    }
  });
  $("#addCmdBtn").onclick = () => { $("#customForm").hidden = !$("#customForm").hidden; if (!$("#customForm").hidden) $("#customForm [name=title]").focus(); };
  $("#customForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.custom.unshift({ id: Date.now().toString(36), title: f.get("title").trim(), cat: f.get("cat"), cmd: f.get("cmd").trim(), tags: f.get("tags").trim() });
    await saveCustom();
    e.target.reset(); e.target.hidden = true;
    state.cheatCat = "__mine"; renderCheat();
    toast("Commande ajoutée à ta cheatsheet");
  };

  // ---- Encodeur ----
  renderOps();
  $("#ops").onclick = (e) => { const b = e.target.closest(".op"); if (b) runOp(b.dataset.op); };
  const rerun = debounce(() => { if (state.lastOp) runOp(state.lastOp); }, 200);
  $("#tIn").addEventListener("input", rerun);
  $("#tKey").addEventListener("input", rerun);
  $("#tUse").onclick = () => { $("#tIn").value = $("#tOut").textContent; state.lastOp = null; renderOps(); $("#tOut").textContent = ""; $("#outLbl").textContent = "sortie"; $("#tIn").focus(); };
  $("#tCopy").onclick = () => $("#tOut").textContent && copyText($("#tOut").textContent);
  $("#tInsert").onclick = () => {
    const out = $("#tOut").textContent;
    if (!out) return;
    if (!state.current) return toast("Ouvre un writeup pour insérer");
    ed().focus();
    ed().insertContent(`<pre class="terminal">${esc(out)}</pre><p></p>`);
    toast("Inséré dans le writeup");
  };

  // ---- Sommaire ----
  $("#toc").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-h]"); if (!a) return;
    e.preventDefault();
    const h = ed().getBody().querySelectorAll("h1,h2,h3")[+a.dataset.h];
    if (h) { h.scrollIntoView({ behavior: "smooth", block: "start" }); ed().selection.select(h, true); ed().selection.collapse(true); }
  });

  document.addEventListener("keydown", (e) => globalKeys(e));
  window.addEventListener("popstate", route);
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty || !state.current) return;
    if (state.mode === "local") { saveNow(); e.preventDefault(); return; }
    try {
      const c = collect();
      fetch("/api/writeups/" + c.id, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...c, content: ed().getContent() }) });
    } catch {}
    e.preventDefault();
  });
}

function route() {
  const m = location.hash.match(/^#\/w\/([a-z0-9]+)/);
  if (m) openWriteup(m[1], { push: false }); else showHome({ push: false });
}

(async function main() {
  bind();
  renderVars();
  initEditor();
  const health = await detectMode();
  state.mode = health.mode;
  if (state.mode === "local") {
    api = localApi;
    $("#modeNote").hidden = false;
  }
  if (state.mode === "cloud") {
    if (!health.configured) return showSetup(health);
    if (!health.authed) await showLogin();
  }
  try {
    [state.list, state.custom] = await Promise.all([api.list(), api.cheat().catch(() => [])]);
  } catch (e) { toast("⚠ Impossible de charger les writeups : " + e.message); }
  renderAll();
  route();
  if (pref.get("drawerOpen", false)) openDrawer(state.drawerTab, { focus: false });
  if (state.mode !== "local") offerMigration();
})();
