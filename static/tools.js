/* Boîte à outils d'encodage / décodage (mini CyberChef, 100 % local) */
"use strict";

(function () {
  const te = new TextEncoder();
  const td = new TextDecoder("utf-8", { fatal: false });
  const bytes = (s) => te.encode(s);
  const str = (b) => td.decode(b instanceof Uint8Array ? b : new Uint8Array(b));
  const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => {
    const c = h.replace(/0x|\\x|[\s:,-]/gi, "");
    if (!/^[0-9a-f]*$/i.test(c) || c.length % 2) throw new Error("hexadécimal invalide");
    return new Uint8Array(c.match(/../g)?.map((x) => parseInt(x, 16)) || []);
  };
  const b64enc = (b) => { let s = ""; b.forEach((x) => (s += String.fromCharCode(x))); return btoa(s); };
  const b64dec = (s) => {
    let c = s.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (c.length % 4) c += "=";
    return Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0));
  };
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const b32enc = (b) => {
    let bits = "", out = "";
    b.forEach((x) => (bits += x.toString(2).padStart(8, "0")));
    for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
    while (out.length % 8) out += "=";
    return out;
  };
  const b32dec = (s) => {
    const c = s.toUpperCase().replace(/[=\s]/g, "");
    let bits = "";
    for (const ch of c) { const v = B32.indexOf(ch); if (v < 0) throw new Error("base32 invalide"); bits += v.toString(2).padStart(5, "0"); }
    const out = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
    return new Uint8Array(out);
  };
  const rot = (s, n) => s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26 + 26) % 26 + base);
  });

  // MD5 (implémentation compacte, crypto.subtle ne le fournit pas)
  function md5(input) {
    const b = input;
    const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
    const len = b.length, n = ((len + 8) >> 6) + 1, w = new Uint32Array(n * 16);
    for (let i = 0; i < len; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
    w[len >> 2] |= 0x80 << ((len % 4) * 8);
    w[n * 16 - 2] = (len * 8) >>> 0;
    w[n * 16 - 1] = Math.floor(len / 0x20000000);
    let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let o = 0; o < w.length; o += 16) {
      let [A, B, C, D] = [a0, b0, c0, d0];
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D; D = C; C = B;
        const x = (A + F + K[i] + w[o + g]) >>> 0, s = S[(i >> 4) * 4 + (i % 4)];
        B = (B + ((x << s) | (x >>> (32 - s)))) >>> 0;
        A = tmp;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    return [a0, b0, c0, d0].map((v) => toHex(new Uint8Array(new Uint32Array([v]).buffer))).join("");
  }
  const sha = async (algo, s) => toHex(new Uint8Array(await crypto.subtle.digest(algo, bytes(s))));

  const keyBytes = (k) => (/^(0x)?[0-9a-f]+$/i.test(k) && k.replace(/^0x/i, "").length % 2 === 0 ? fromHex(k) : bytes(k));
  const inputBytes = (s) => { try { if (/^[0-9a-f\s]+$/i.test(s) && s.replace(/\s/g, "").length % 2 === 0) return fromHex(s); } catch {} return bytes(s); };
  const printable = (s) => /^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(s) && !s.includes("�");

  window.TOOL_OPS = [
    { group: "Base", id: "b64e", label: "Base64 →", run: (s) => b64enc(bytes(s)) },
    { group: "Base", id: "b64d", label: "Base64 ←", run: (s) => str(b64dec(s)) },
    { group: "Base", id: "b32e", label: "Base32 →", run: (s) => b32enc(bytes(s)) },
    { group: "Base", id: "b32d", label: "Base32 ←", run: (s) => str(b32dec(s)) },
    { group: "Base", id: "hexe", label: "Hex →", run: (s) => toHex(bytes(s)) },
    { group: "Base", id: "hexd", label: "Hex ←", run: (s) => str(fromHex(s)) },
    { group: "Base", id: "bine", label: "Binaire →", run: (s) => [...bytes(s)].map((x) => x.toString(2).padStart(8, "0")).join(" ") },
    { group: "Base", id: "bind", label: "Binaire ←", run: (s) => str(new Uint8Array((s.replace(/[^01]/g, "").match(/.{8}/g) || []).map((x) => parseInt(x, 2)))) },
    { group: "Base", id: "dece", label: "Décimal →", run: (s) => [...bytes(s)].join(" ") },
    { group: "Base", id: "decd", label: "Décimal ←", run: (s) => str(new Uint8Array(s.split(/[^0-9]+/).filter(Boolean).map(Number))) },
    { group: "Web", id: "urle", label: "URL →", run: (s) => encodeURIComponent(s) },
    { group: "Web", id: "urld", label: "URL ←", run: (s) => decodeURIComponent(s.replace(/\+/g, " ")) },
    { group: "Web", id: "htme", label: "HTML entités →", run: (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) },
    { group: "Web", id: "htmd", label: "HTML entités ←", run: (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; } },
    { group: "Web", id: "jwt", label: "JWT décoder", run: (s) => {
      const [h, p, sig] = s.trim().split(".");
      if (!p) throw new Error("JWT invalide (3 parties attendues)");
      const j = (x) => JSON.stringify(JSON.parse(str(b64dec(x))), null, 2);
      return `// header\n${j(h)}\n\n// payload\n${j(p)}\n\n// signature\n${sig || "(aucune — alg none ?)"}`;
    } },
    { group: "Web", id: "unie", label: "\\uXXXX ←", run: (s) => s.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, u, x) => String.fromCharCode(parseInt(u || x, 16))) },
    { group: "Chiffres", id: "rot13", label: "ROT13", run: (s) => rot(s, 13) },
    { group: "Chiffres", id: "rotall", label: "César (tous)", run: (s) => Array.from({ length: 25 }, (_, i) => `ROT${String(i + 1).padStart(2, "0")}  ${rot(s, i + 1)}`).join("\n") },
    { group: "Chiffres", id: "rot47", label: "ROT47", run: (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(33 + ((c.charCodeAt(0) + 14) % 94))) },
    { group: "Chiffres", id: "atbash", label: "Atbash", run: (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(b + 25 - (c.charCodeAt(0) - b)); }) },
    { group: "Chiffres", id: "xor", label: "XOR (clé)", key: true, run: (s, k) => {
      if (!k) throw new Error("renseigne une clé (texte ou hex)");
      const d = inputBytes(s), kb = keyBytes(k), out = d.map((x, i) => x ^ kb[i % kb.length]);
      const t = str(out);
      return printable(t) ? t : toHex(out);
    } },
    { group: "Chiffres", id: "xorbf", label: "XOR 1 octet (brute)", run: (s) => {
      const d = inputBytes(s), res = [];
      for (let k = 1; k < 256; k++) { const t = str(d.map((x) => x ^ k)); if (/^[\x20-\x7e\n\r\t]+$/.test(t)) res.push(`0x${k.toString(16).padStart(2, "0")}  ${t}`); }
      return res.join("\n") || "Aucun résultat imprimable";
    } },
    { group: "Hash", id: "md5", label: "MD5", run: (s) => md5(bytes(s)) },
    { group: "Hash", id: "sha1", label: "SHA-1", run: (s) => sha("SHA-1", s) },
    { group: "Hash", id: "sha256", label: "SHA-256", run: (s) => sha("SHA-256", s) },
    { group: "Hash", id: "sha512", label: "SHA-512", run: (s) => sha("SHA-512", s) },
    { group: "Texte", id: "rev", label: "Inverser", run: (s) => [...s].reverse().join("") },
    { group: "Texte", id: "up", label: "MAJUSCULES", run: (s) => s.toUpperCase() },
    { group: "Texte", id: "low", label: "minuscules", run: (s) => s.toLowerCase() },
    { group: "Texte", id: "len", label: "Infos", run: (s) => {
      const b = bytes(s);
      const freq = {}; for (const c of s) freq[c] = (freq[c] || 0) + 1;
      const ent = -Object.values(freq).reduce((a, n) => a + (n / s.length) * Math.log2(n / s.length), 0);
      return `Caractères : ${[...s].length}\nOctets     : ${b.length}\nLignes     : ${s.split("\n").length}\nEntropie   : ${(ent || 0).toFixed(3)} bits/caractère\nHash type ? : ${guessHash(s.trim())}`;
    } },
    { group: "Magie", id: "magic", label: "✨ Auto-détection", run: (s) => magic(s) },
  ];

  function guessHash(h) {
    if (/^\$2[aby]\$/.test(h)) return "bcrypt (hashcat -m 3200)";
    if (/^\$6\$/.test(h)) return "sha512crypt (-m 1800)";
    if (/^\$5\$/.test(h)) return "sha256crypt (-m 7400)";
    if (/^\$1\$/.test(h)) return "md5crypt (-m 500)";
    if (/^\$y\$/.test(h)) return "yescrypt (john --format=crypt)";
    if (!/^[0-9a-f]+$/i.test(h)) return "—";
    return { 32: "MD5 / NTLM (-m 0 / -m 1000)", 40: "SHA-1 (-m 100)", 64: "SHA-256 (-m 1400)", 128: "SHA-512 (-m 1700)" }[h.length] || "—";
  }

  // Essaie des décodages courants en cascade et affiche ce qui ressemble à du texte
  function magic(input) {
    const tries = [
      ["Base64", (s) => /^[A-Za-z0-9+/=_\-\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? str(b64dec(s)) : null],
      ["Base32", (s) => /^[A-Z2-7=\s]+$/i.test(s) && s.length >= 8 ? str(b32dec(s)) : null],
      ["Hex", (s) => /^(0x)?[0-9a-f\s:]+$/i.test(s) ? str(fromHex(s)) : null],
      ["Binaire", (s) => /^[01\s]+$/.test(s) && s.replace(/\s/g, "").length % 8 === 0 ? str(new Uint8Array(s.replace(/\s/g, "").match(/.{8}/g).map((x) => parseInt(x, 2)))) : null],
      ["Décimal", (s) => /^(\d{2,3}[\s,]+)+\d{2,3}$/.test(s.trim()) ? str(new Uint8Array(s.split(/[^0-9]+/).filter(Boolean).map(Number))) : null],
      ["URL", (s) => /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : null],
      ["ROT13", (s) => /[a-z]/i.test(s) ? rot(s, 13) : null],
    ];
    const out = [];
    const seen = new Set();
    function walk(s, path, depth) {
      if (depth > 4) return;
      for (const [name, f] of tries) {
        let r;
        try { r = f(s.trim()); } catch { r = null; }
        if (!r || r === s || !printable(r) || r.trim().length < 2 || seen.has(r)) continue;
        if (name === "ROT13" && depth > 0) continue;
        seen.add(r);
        const p = [...path, name];
        const flag = /[a-z0-9_]{2,}\{[^}]+\}/i.test(r);
        out.push({ p, r, flag });
        if (name !== "ROT13") walk(r, p, depth + 1);
      }
    }
    walk(input, [], 0);
    if (!out.length) return "Rien trouvé : essaie XOR, César ou le hash.";
    out.sort((a, b) => b.flag - a.flag || a.p.length - b.p.length);
    return out.slice(0, 15).map((o) => `${o.flag ? "🚩 " : ""}[${o.p.join(" → ")}]\n${o.r}`).join("\n\n");
  }
})();
