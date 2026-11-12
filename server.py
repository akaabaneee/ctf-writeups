#!/usr/bin/env python3
"""CTF Writeups — petit serveur local (stdlib uniquement).

Stocke chaque writeup dans data/writeups/<id>.json et les images collées
dans data/images/. Lance : python3 server.py  →  http://127.0.0.1:8137
"""
import io
from html import unescape
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA = ROOT / "data"
WRITEUPS = DATA / "writeups"
IMAGES = DATA / "images"
TRASH = DATA / "corbeille"
for d in (WRITEUPS, IMAGES, TRASH):
    d.mkdir(parents=True, exist_ok=True)

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8137"))
ID_RE = re.compile(r"^[a-z0-9]{12}$")
IMG_RE = re.compile(r"^[a-z0-9_-]+\.(png|jpe?g|gif|webp|svg|bmp)$")
IMG_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
}
META_KEYS = ("title", "ctf", "category", "difficulty", "points", "date",
             "status", "tags", "flag", "pageWidth", "pageTheme", "pinned")
MAX_BODY = 50 * 1024 * 1024  # 50 Mo


def now_ms():
    return int(time.time() * 1000)


def atomic_write(path: Path, data: bytes):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def load(wid):
    p = WRITEUPS / f"{wid}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text("utf-8"))


def save(doc):
    atomic_write(WRITEUPS / f"{doc['id']}.json",
                 json.dumps(doc, ensure_ascii=False, indent=1).encode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    server_version = "CTFWriteups/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---------- helpers ----------
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, cache=False):
        if not path.is_file():
            return self.send_json({"error": "introuvable"}, 404)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-cache")
        if path.suffix == ".svg":
            self.send_header("Content-Security-Policy", "script-src 'none'")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("trop gros")
        return self.rfile.read(n) if n else b""

    def read_json(self):
        return json.loads(self.read_body() or b"{}")

    def same_origin(self):
        # Protège l'API contre les requêtes d'autres sites ouverts dans le navigateur
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        host = self.headers.get("Host", "")
        return urlparse(origin).netloc == host

    # ---------- routes ----------
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/writeups":
            items = []
            for p in WRITEUPS.glob("*.json"):
                try:
                    d = json.loads(p.read_text("utf-8"))
                except Exception:
                    continue
                html = d.pop("content", "") or ""
                # texte brut pour la recherche plein texte côté client
                txt = re.sub(r"<[^>]+>", " ", html)
                d["text"] = re.sub(r"\s+", " ", unescape(txt))[:100000]
                items.append(d)
            items.sort(key=lambda d: d.get("updated", 0), reverse=True)
            return self.send_json(items)
        m = re.fullmatch(r"/api/writeups/([a-z0-9]+)", path)
        if m:
            doc = load(m[1]) if ID_RE.match(m[1]) else None
            return self.send_json(doc) if doc else self.send_json({"error": "introuvable"}, 404)
        if path == "/api/cheatsheet":
            p = DATA / "cheatsheet.json"
            return self.send_json(json.loads(p.read_text("utf-8")) if p.exists() else [])
        if path == "/api/export":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                extra = [DATA / "cheatsheet.json"] if (DATA / "cheatsheet.json").exists() else []
                for p in list(WRITEUPS.glob("*.json")) + list(IMAGES.iterdir()) + extra:
                    z.write(p, p.relative_to(DATA))
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition",
                             f'attachment; filename="writeups-{time.strftime("%Y%m%d")}.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/images/"):
            name = path[len("/images/"):]
            if not IMG_RE.match(name):
                return self.send_json({"error": "nom invalide"}, 400)
            return self.send_file(IMAGES / name, cache=True)
        # fichiers statiques
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC)):
            return self.send_json({"error": "interdit"}, 403)
        return self.send_file(target, cache="/vendor/" in path)

    def do_POST(self):
        if not self.same_origin():
            return self.send_json({"error": "origine refusée"}, 403)
        path = urlparse(self.path).path
        try:
            if path == "/api/writeups":
                body = self.read_json()
                doc = {k: body.get(k, "") for k in META_KEYS}
                doc.update(id=secrets.token_hex(6), content=body.get("content", ""),
                           created=now_ms(), updated=now_ms())
                doc["title"] = doc["title"] or "Sans titre"
                doc["tags"] = body.get("tags") or []
                save(doc)
                return self.send_json(doc, 201)
            if path == "/api/upload":
                ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
                ext = IMG_EXT.get(ctype)
                if not ext:
                    return self.send_json({"error": f"type non supporté : {ctype}"}, 415)
                data = self.read_body()
                name = f"{time.strftime('%Y%m%d')}-{secrets.token_hex(5)}.{ext}"
                atomic_write(IMAGES / name, data)
                return self.send_json({"location": f"/images/{name}"})
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        self.send_json({"error": "introuvable"}, 404)

    def do_PUT(self):
        if not self.same_origin():
            return self.send_json({"error": "origine refusée"}, 403)
        if urlparse(self.path).path == "/api/cheatsheet":
            try:
                items = self.read_json()
                if not isinstance(items, list):
                    raise ValueError("liste attendue")
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            atomic_write(DATA / "cheatsheet.json", json.dumps(items, ensure_ascii=False, indent=1).encode("utf-8"))
            return self.send_json({"ok": True})
        m = re.fullmatch(r"/api/writeups/([a-z0-9]+)", urlparse(self.path).path)
        if not m or not ID_RE.match(m[1]):
            return self.send_json({"error": "introuvable"}, 404)
        doc = load(m[1])
        if not doc:
            return self.send_json({"error": "introuvable"}, 404)
        try:
            body = self.read_json()
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        for k in META_KEYS + ("content",):
            if k in body:
                doc[k] = body[k]
        doc["updated"] = now_ms()
        save(doc)
        doc.pop("content", None)
        self.send_json(doc)

    def do_DELETE(self):
        if not self.same_origin():
            return self.send_json({"error": "origine refusée"}, 403)
        m = re.fullmatch(r"/api/writeups/([a-z0-9]+)", urlparse(self.path).path)
        if not m or not ID_RE.match(m[1]):
            return self.send_json({"error": "introuvable"}, 404)
        src = WRITEUPS / f"{m[1]}.json"
        if src.exists():
            shutil.move(src, TRASH / f"{m[1]}-{int(time.time())}.json")  # récupérable
        self.send_json({"ok": True})


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"✔ CTF Writeups → http://{HOST}:{PORT}   (Ctrl+C pour arrêter)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")
