/* Effets de fond (canvas, aucune dépendance)
   - Fond de l'accueil : 10 variantes au choix (CW_FX.MODES), choix mémorisé dans ce navigateur.
   - Écran de connexion : pluie Matrix (CW_FX.matrix).
   ~30 images/s, en pause si l'onglet est caché ou pendant l'édition, image fixe si l'utilisateur
   préfère réduire les animations. */
"use strict";

(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const rgba = (rgb, a) => `rgba(${rgb},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  /* Boucle d'animation commune : appelle draw(dt) ~fps fois par seconde tant que active() */
  function loop(draw, fps, active) {
    let raf = 0, last = 0;
    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 1000 / fps - 2) return;
      const dt = Math.min(t - last, 100) / 1000;
      last = t;
      draw(dt);
    };
    const sync = () => {
      cancelAnimationFrame(raf); raf = 0;
      if (active()) { last = performance.now(); raf = requestAnimationFrame(frame); } else draw(0);
    };
    document.addEventListener("visibilitychange", sync);
    reduce.addEventListener?.("change", sync);
    return { sync, stop: () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", sync); } };
  }

  function fit(canvas, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  /* =====================================================================
     Les 10 fonds. Chacun reçoit l'environnement E et renvoie { draw(dt) }.
     E : ctx, W, H, dpr, c1/c2 (couleurs "r,g,b"), base ("r,g,b" du fond), light, mouse, t (temps)
     ===================================================================== */
  const MODES = {};

  /* 1. Circuit imprimé : pistes + impulsions de données, pistes éclairées sous la souris */
  MODES.circuit = {
    name: "Circuit imprimé", desc: "Pistes de carte mère, impulsions de données, éclairage sous la souris",
    init(E) {
      const CELL = 26, R = 190;
      const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const cols = Math.ceil(E.W / CELL) + 1, rows = Math.ceil(E.H / CELL) + 1, used = new Set(), traces = [];
      const target = Math.round((E.W * E.H) / 9000);
      for (let n = 0, tries = 0; n < target && tries < target * 6; tries++) {
        let x = (Math.random() * cols) | 0, y = (Math.random() * rows) | 0;
        if (used.has(x + "," + y)) continue;
        let d = ((Math.random() * 4) | 0) * 2;
        const pts = [[x, y]]; used.add(x + "," + y);
        const len = 4 + ((Math.random() * 16) | 0);
        for (let i = 0; i < len; i++) {
          if (Math.random() < 0.22) d = (d + (Math.random() < 0.5 ? 1 : 7)) % 8;
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || used.has(nx + "," + ny)) break;
          x = nx; y = ny; used.add(x + "," + y); pts.push([x, y]);
        }
        if (pts.length < 3) continue;
        const P = pts.map(([a, b]) => [a * CELL + 0.5, b * CELL + 0.5]), cum = [0];
        for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
        traces.push({ P, cum, total: cum[cum.length - 1], glow: 0 });
        n++;
      }
      const layer = (a, lw) => {
        const o = document.createElement("canvas"); o.width = E.W * E.dpr; o.height = E.H * E.dpr;
        const c = o.getContext("2d"); c.setTransform(E.dpr, 0, 0, E.dpr, 0, 0); c.lineCap = c.lineJoin = "round";
        for (const t of traces) {
          c.strokeStyle = rgba(E.c1, a); c.lineWidth = lw;
          c.beginPath(); c.moveTo(t.P[0][0], t.P[0][1]); for (let i = 1; i < t.P.length; i++) c.lineTo(t.P[i][0], t.P[i][1]); c.stroke();
          for (const [px, py] of [t.P[0], t.P[t.P.length - 1]]) {
            c.beginPath(); c.arc(px, py, 2.6, 0, TAU); c.fillStyle = rgba(E.base, 0.95); c.fill();
            c.strokeStyle = rgba(E.c1, a * 1.6); c.lineWidth = 1.2; c.stroke();
          }
        }
        return o;
      };
      const base = layer(E.light ? 0.16 : 0.13, 1.1), bright = layer(E.light ? 0.6 : 0.55, 1.4);
      const lens = document.createElement("canvas"), lctx = lens.getContext("2d");
      lens.width = lens.height = Math.ceil(R * 2 * E.dpr);
      const pulses = [];
      const spawn = (mid) => { if (!traces.length) return; const t = traces[(Math.random() * traces.length) | 0]; pulses.push({ t, d: mid ? Math.random() * t.total : 0, rev: Math.random() < 0.5, v: rand(70, 180), cyan: Math.random() < 0.35, tail: rand(34, 74) }); };
      for (let i = 0; i < Math.max(8, traces.length / 7); i++) spawn(true);
      const at = (t, dist) => {
        dist = Math.max(0, Math.min(t.total, dist));
        let i = 1; while (i < t.cum.length - 1 && t.cum[i] < dist) i++;
        const a = t.P[i - 1], b = t.P[i], k = (dist - t.cum[i - 1]) / (t.cum[i] - t.cum[i - 1] || 1);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      };
      const m = { x: -999, y: -999 };
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          ctx.clearRect(0, 0, W, H);
          ctx.drawImage(base, 0, 0, W, H);
          m.x += (E.mouse.x - m.x) * Math.min(1, dt * 8 || 1); m.y += (E.mouse.y - m.y) * Math.min(1, dt * 8 || 1);
          if (E.mouse.x > -500) {
            const L = R * 2 * E.dpr;
            lctx.globalCompositeOperation = "source-over"; lctx.clearRect(0, 0, L, L);
            lctx.drawImage(bright, (m.x - R) * E.dpr, (m.y - R) * E.dpr, L, L, 0, 0, L, L);
            lctx.globalCompositeOperation = "destination-in";
            const g = lctx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
            g.addColorStop(0, "#000"); g.addColorStop(1, "rgba(0,0,0,0)"); lctx.fillStyle = g; lctx.fillRect(0, 0, L, L);
            ctx.drawImage(lens, m.x - R, m.y - R, R * 2, R * 2);
          }
          ctx.lineCap = "round";
          for (let i = pulses.length - 1; i >= 0; i--) {
            const p = pulses[i]; p.d += p.v * dt;
            if (p.d - p.tail > p.t.total) { pulses.splice(i, 1); p.t.glow = 1; spawn(false); continue; }
            const col = p.cyan ? E.c2 : E.c1, S = 8;
            for (let s = 0; s < S; s++) {
              const d0 = p.d - (p.tail * s) / S, d1 = p.d - (p.tail * (s + 1)) / S;
              if (d1 > p.t.total || d0 < 0) continue;
              const [x0, y0] = at(p.t, p.rev ? p.t.total - d0 : d0), [x1, y1] = at(p.t, p.rev ? p.t.total - d1 : d1);
              ctx.strokeStyle = rgba(col, (1 - s / S) * 0.85); ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            }
            if (p.d <= p.t.total) {
              const [hx, hy] = at(p.t, p.rev ? p.t.total - p.d : p.d);
              const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 10); g.addColorStop(0, rgba(col, 0.7)); g.addColorStop(1, rgba(col, 0));
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, TAU); ctx.fill();
              ctx.fillStyle = E.light ? rgba(col, 1) : "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.arc(hx, hy, 1.8, 0, TAU); ctx.fill();
            }
          }
          for (const t of traces) {
            if (t.glow <= 0) continue;
            for (const [x, y] of [t.P[0], t.P[t.P.length - 1]]) {
              const g = ctx.createRadialGradient(x, y, 0, x, y, 14); g.addColorStop(0, rgba(E.c1, t.glow * 0.6)); g.addColorStop(1, rgba(E.c1, 0));
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.fill();
            }
            t.glow = Math.max(0, t.glow - dt * 1.4);
          }
        },
      };
    },
  };

  /* 2. Pluie Matrix douce (version discrète de l'écran de connexion) */
  MODES.matrix = {
    name: "Pluie Matrix", desc: "La pluie de caractères verte, en version discrète derrière l'accueil",
    init(E) {
      const FS = 15, cols = Math.ceil(E.W / FS);
      const CH = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF<>{}$#";
      const drops = Array.from({ length: cols }, () => rand(-E.H / FS, E.H / FS)), sp = drops.map(() => rand(0.4, 1.2));
      E.ctx.clearRect(0, 0, E.W, E.H);
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          if (!dt) return;
          ctx.globalCompositeOperation = "destination-out";       // efface progressivement (traînée)
          ctx.fillStyle = "rgba(0,0,0,.09)"; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = "source-over";
          ctx.font = `600 ${FS}px "JetBrains Mono", monospace`; ctx.textBaseline = "top";
          for (let i = 0; i < cols; i++) {
            const y = drops[i] * FS;
            ctx.fillStyle = E.light ? rgba(E.c1, 0.75) : "rgba(220,255,240,.75)";
            ctx.fillText(CH[(Math.random() * CH.length) | 0], i * FS, y);
            ctx.fillStyle = rgba(E.c1, E.light ? 0.35 : 0.45);
            ctx.fillText(CH[(Math.random() * CH.length) | 0], i * FS, y - FS);
            drops[i] += sp[i] * dt * 18;
            if (y > H && Math.random() > 0.97) { drops[i] = rand(-30, 0); sp[i] = rand(0.4, 1.2); }
          }
        },
      };
    },
  };

  /* 3. Synthwave : soleil rétro et grille en perspective qui défile (esthétique années 80 / Tron) */
  MODES.synthwave = {
    name: "Synthwave", desc: "Soleil rétro et grille néon en perspective qui défile, façon Outrun / Tron",
    init(E) {
      let off = 0;
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          ctx.clearRect(0, 0, W, H);
          const hz = H * 0.58, cx = W * 0.62;
          // soleil à bandes
          const R = Math.min(W, H) * 0.2, sy = hz - R * 0.55;
          const g = ctx.createLinearGradient(0, sy - R, 0, sy + R);
          g.addColorStop(0, rgba(E.c2, E.light ? 0.55 : 0.75)); g.addColorStop(1, rgba(E.c1, E.light ? 0.4 : 0.6));
          ctx.save(); ctx.beginPath(); ctx.arc(cx, sy, R, 0, TAU); ctx.clip();
          ctx.fillStyle = g; ctx.fillRect(cx - R, sy - R, R * 2, R * 2);
          ctx.globalCompositeOperation = "destination-out";
          for (let i = 0; i < 7; i++) { const yy = sy + R * 0.1 + i * R * 0.14 + ((off * 8) % (R * 0.14)); ctx.fillRect(cx - R, yy, R * 2, 2 + i * 1.6); }
          ctx.restore();
          const halo = ctx.createRadialGradient(cx, sy, R * 0.8, cx, sy, R * 2.2);
          halo.addColorStop(0, rgba(E.c2, E.light ? 0.12 : 0.18)); halo.addColorStop(1, rgba(E.c2, 0));
          ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
          // sol (masque le bas du soleil)
          ctx.fillStyle = rgba(E.base, 1); ctx.fillRect(0, hz, W, H - hz);
          // grille : horizontales (défilent vers nous) + verticales qui convergent
          off = (off + dt * 0.35) % 1;
          ctx.lineWidth = 1.2;
          for (let i = 0; i < 26; i++) {
            const z = (i + 1 - off) / 26, y = hz + (H - hz) * Math.pow(z, 2.2);
            ctx.strokeStyle = rgba(E.c1, (E.light ? 0.4 : 0.55) * z + 0.05);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
          }
          for (let i = -24; i <= 24; i++) {
            ctx.strokeStyle = rgba(E.c1, E.light ? 0.28 : 0.38);
            ctx.beginPath(); ctx.moveTo(cx + i * 14, hz); ctx.lineTo(cx + i * W * 0.11, H); ctx.stroke();
          }
          ctx.strokeStyle = rgba(E.c2, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke();
          const fade = ctx.createLinearGradient(0, hz, 0, hz + 60); fade.addColorStop(0, rgba(E.base, 0.85)); fade.addColorStop(1, rgba(E.base, 0));
          ctx.fillStyle = fade; ctx.fillRect(0, hz + 1, W, 60);
        },
      };
    },
  };

  /* 4. Hyperespace (inspiré de Star Wars), aux couleurs du compte.
        Étoiles réparties dans un cylindre autour de la caméra (le centre reste un « couloir » vide),
        traînées avec flou de mouvement, parois de lumière qui défilent, nuages de gaz traversés,
        cœur lumineux, reflet horizontal de caméra, secousses et halo lumineux (bloom).
        Phases : calme → accélération → flash → croisière. jump() relance le saut. */
  MODES.warp = {
    name: "Hyperespace", desc: "Saut en vitesse lumière : accélération, traînées, tunnel de lumière aux couleurs du compte",
    init(E) {
      const mixW = (rgb, k) => rgb.split(",").map((v) => Math.round(+v + (255 - +v) * k)).join(",");   // éclaircit vers le blanc
      const N = Math.max(320, Math.min(900, Math.round((E.W * E.H) / 1900)));
      const spawn = (s, far) => {
        const th = rand(0, TAU), r = Math.random() < 0.85 ? rand(0.2, 1.35) : rand(0.04, 0.2);
        s.x = Math.cos(th) * r * 1.45; s.y = Math.sin(th) * r;
        s.z = far ? rand(1.0, 1.35) : rand(0.05, 1.35);
        s.b = rand(0.45, 1); s.k = Math.random() < 0.25 ? 2 : Math.random() < 0.6 ? 0 : 1; s.w = rand(0.6, 1.5);
        return s;
      };
      const stars = Array.from({ length: N }, () => spawn({}, false));
      const walls = Array.from({ length: 140 }, () => ({ th: rand(0, TAU), z: rand(0.05, 1.4), r: rand(1.0, 1.9), w: rand(3, 11), a: rand(0.05, 0.16), k: Math.random() < 0.5 }));
      const clouds = Array.from({ length: 9 }, () => ({ th: rand(0, TAU), z: rand(0.15, 1.4), r: rand(0.25, 1.1), s: rand(0.5, 1.3), k: Math.random() < 0.5 }));
      const small = document.createElement("canvas"), sctx = small.getContext("2d");
      small.width = Math.max(1, Math.round(E.W / 5)); small.height = Math.max(1, Math.round(E.H / 5));
      const c = { x: E.W / 2, y: E.H / 2 };
      let t = 0, v = 0.03, flash = 0, flashed = false, rot = 0;
      const IDLE = 1.0, ACC = 2.3;
      const speedAt = (tt) => {
        if (tt < IDLE) return 0.03;
        if (tt < IDLE + ACC) { const k = (tt - IDLE) / ACC; return 0.03 + Math.pow(k, 3.4) * 4.4; }
        return 2.5 + Math.sin(tt * 0.9) * 0.22 + Math.sin(tt * 2.7) * 0.08;
      };
      return {
        jump() { t = 0; flashed = false; },
        draw(dt) {
          const { ctx, W, H, mouse } = E, dark = !E.light;
          t += dt; v = speedAt(t);
          const accK = t > IDLE && t < IDLE + ACC ? (t - IDLE) / ACC : 0;
          if (!flashed && t > IDLE + ACC * 0.94) { flash = 1; flashed = true; }
          const hyper = Math.min(1, Math.max(0, (v - 0.12) / 2.0));
          const C1 = E.c1, C2 = E.c2, HEAD1 = mixW(C1, 0.6), HEAD2 = mixW(C2, 0.6);
          const cols = [C1, C2, mixW(C1, 0.85)], heads = [HEAD1, HEAD2, "255,255,255"];
          // fond
          if (dark) { ctx.fillStyle = "#010406"; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
          // centre (suit un peu la souris) + secousses de caméra
          const tx = mouse.x > -500 ? W / 2 + (mouse.x - W / 2) * 0.1 : W / 2, ty = mouse.y > -500 ? H / 2 + (mouse.y - H / 2) * 0.1 : H / 2;
          c.x += (tx - c.x) * Math.min(1, dt * 1.5); c.y += (ty - c.y) * Math.min(1, dt * 1.5);
          const shake = accK * accK * 4 + hyper * 0.9;
          const cx = c.x + rand(-shake, shake), cy = c.y + rand(-shake, shake);
          rot += dt * 0.035 * hyper;
          const F = Math.max(W, H) * 0.42, cr = Math.cos(rot), sr = Math.sin(rot);
          const P = (x, y, z) => { const rx = x * cr - y * sr, ry = x * sr + y * cr; return [cx + (rx / z) * F, cy + (ry / z) * F]; };
          ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
          // nuages de gaz qu'on traverse
          for (const n of clouds) {
            n.z -= v * dt * 0.32;
            if (n.z < 0.08) { n.z = rand(1.2, 1.4); n.th = rand(0, TAU); n.r = rand(0.25, 1.1); }
            if (hyper < 0.05) continue;
            const [x, y] = P(Math.cos(n.th) * n.r * 1.4, Math.sin(n.th) * n.r, n.z);
            const R = (n.s * F * 0.45) / n.z, al = hyper * (dark ? 0.09 : 0.06) * Math.min(1, (1.4 - n.z) * 1.5) * Math.min(1, n.z * 4);
            const g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, rgba(n.k ? C2 : C1, al)); g.addColorStop(1, rgba(n.k ? C2 : C1, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
          }
          // cœur lumineux au bout du tunnel
          if (hyper > 0.02) {
            const R = F * (0.12 + hyper * 0.3);
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
            g.addColorStop(0, rgba(dark ? "255,255,255" : C1, (dark ? 0.55 : 0.18) * hyper));
            g.addColorStop(0.2, rgba(dark ? HEAD1 : C1, (dark ? 0.32 : 0.12) * hyper));
            g.addColorStop(1, rgba(C1, 0));
            ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
          }
          // parois du tunnel : longues bandes de lumière floues qui défilent sur les bords
          ctx.lineCap = "round";
          for (const w of walls) {
            w.z -= v * dt * 0.75;
            if (w.z < 0.05) { w.z = rand(1.2, 1.4); w.th = rand(0, TAU); }
            if (hyper < 0.05) continue;
            const x = Math.cos(w.th) * w.r * 1.4, y = Math.sin(w.th) * w.r;
            const [hx, hy] = P(x, y, w.z), [qx, qy] = P(x, y, Math.min(1.5, w.z + 0.25 + v * 0.3));
            const g = ctx.createLinearGradient(qx, qy, hx, hy); const col = w.k ? C2 : C1;
            g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, w.a * hyper * (dark ? 1 : 0.7)));
            ctx.strokeStyle = g; ctx.lineWidth = w.w * (1.4 - w.z);
            ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(hx, hy); ctx.stroke();
          }
          // étoiles / traînées avec flou de mouvement
          const tail = Math.min(1.1, 0.002 + v * 0.36);
          for (const s of stars) {
            s.z -= v * dt * 0.6;
            if (s.z <= 0.015) { spawn(s, true); continue; }
            const [hx, hy] = P(s.x, s.y, s.z);
            if (hx < -100 || hx > W + 100 || hy < -100 || hy > H + 100) { spawn(s, true); continue; }
            const near = Math.max(0, 1 - s.z / 1.35), a = Math.min(1, (0.2 + near * 1.1) * s.b) * Math.min(1, (1.35 - s.z) * 6);
            if (hyper < 0.03) {
              const tw = 0.75 + 0.25 * Math.sin(t * 3 + s.b * 40);
              ctx.fillStyle = rgba(dark ? heads[s.k] : cols[s.k], a * tw);
              ctx.beginPath(); ctx.arc(hx, hy, 0.5 + near * 1.6 * s.w, 0, TAU); ctx.fill();
              continue;
            }
            const [qx, qy] = P(s.x, s.y, Math.min(1.6, s.z + tail));
            const g = ctx.createLinearGradient(qx, qy, hx, hy);
            g.addColorStop(0, rgba(cols[s.k], 0));
            g.addColorStop(0.75, rgba(cols[s.k], a * (dark ? 0.75 : 0.6)));
            g.addColorStop(1, rgba(dark ? heads[s.k] : cols[s.k], a));
            ctx.strokeStyle = g; ctx.lineWidth = s.w * (0.35 + near * near * 3.2);
            ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(hx, hy); ctx.stroke();
          }
          // reflet horizontal de caméra (flare anamorphique)
          if (hyper > 0.05 && dark) {
            const g = ctx.createLinearGradient(0, 0, W, 0), al = hyper * (0.22 + Math.sin(t * 2.1) * 0.05);
            g.addColorStop(0, rgba(C1, 0)); g.addColorStop(0.5, rgba(HEAD1, al)); g.addColorStop(1, rgba(C1, 0));
            ctx.fillStyle = g; ctx.fillRect(0, cy - 1.2, W, 2.4);
            ctx.fillStyle = rgba(C1, al * 0.25); ctx.fillRect(0, cy - 10, W, 20);
          }
          ctx.globalCompositeOperation = "source-over";
          // halo lumineux (bloom) : l'image réduite puis agrandie, ajoutée par-dessus
          if (dark && hyper > 0.02) {
            sctx.clearRect(0, 0, small.width, small.height);
            sctx.drawImage(ctx.canvas, 0, 0, small.width, small.height);
            ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55 * hyper;
            ctx.drawImage(small, 0, 0, W, H);
            ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
          }
          if (flash > 0) {
            ctx.fillStyle = rgba(dark ? HEAD1 : "255,255,255", flash * (dark ? 0.8 : 0.85));
            ctx.fillRect(0, 0, W, H);
            flash = Math.max(0, flash - dt * 2.0);
          }
        },
      };
    },
  };

  /* 5. Constellation : particules reliées entre elles et au curseur (particles.js, le grand classique) */
  MODES.constellation = {
    name: "Constellation", desc: "Particules qui dérivent et se relient entre elles et à la souris (style particles.js)",
    init(E) {
      const N = Math.max(30, Math.min(120, Math.round((E.W * E.H) / 14000))), LINK = 140;
      const P = Array.from({ length: N }, () => { const a = rand(0, TAU), v = rand(8, 26); return { x: rand(0, E.W), y: rand(0, E.H), vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rand(1, 2.4) }; });
      return {
        draw(dt) {
          const { ctx, W, H, mouse } = E;
          ctx.clearRect(0, 0, W, H);
          for (const p of P) {
            p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
            const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
            if (d < 120 && d > 0) { p.x += (dx / d) * 30 * dt; p.y += (dy / d) * 30 * dt; }   // les particules s'écartent du curseur
          }
          ctx.lineWidth = 1;
          for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
            const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < LINK) { ctx.strokeStyle = rgba(E.c1, (1 - d / LINK) * 0.4); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
          }
          for (const p of P) {
            const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
            if (d < 200) { ctx.strokeStyle = rgba(E.c2, (1 - d / 200) * 0.6); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
            ctx.fillStyle = rgba(E.c1, 0.85); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
          }
        },
      };
    },
  };

  /* 6. Aurore boréale : rubans lumineux ondulants */
  MODES.aurora = {
    name: "Aurore boréale", desc: "Rubans de lumière qui ondulent lentement, très doux et hypnotique",
    init(E) {
      const bands = [0, 1, 2, 3].map((i) => ({ y: 0.22 + i * 0.13, a: rand(40, 90), f: rand(0.0018, 0.0036), s: rand(0.15, 0.35) * (i % 2 ? 1 : -1), ph: rand(0, TAU), col: i % 2 ? "c2" : "c1", h: rand(120, 220) }));
      let t = 0;
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          t += dt;
          ctx.clearRect(0, 0, W, H);
          ctx.globalCompositeOperation = E.light ? "multiply" : "lighter";
          for (const b of bands) {
            const col = E[b.col], y0 = b.y * H;
            for (let k = 0; k < 3; k++) {     // trois couches décalées pour l'effet de voile
              const g = ctx.createLinearGradient(0, y0 - b.h, 0, y0 + b.h * 0.6);
              g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.65, rgba(col, (E.light ? 0.16 : 0.13) / (k + 1))); g.addColorStop(1, rgba(col, 0));
              ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
              for (let x = 0; x <= W + 20; x += 20) {
                const y = y0 + Math.sin(x * b.f + t * b.s + b.ph + k * 0.6) * b.a + Math.sin(x * b.f * 2.3 - t * b.s * 1.7) * b.a * 0.35;
                ctx.lineTo(x, y);
              }
              ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
            }
          }
          ctx.globalCompositeOperation = "source-over";
        },
      };
    },
  };

  /* 7. Grille hexagonale : nid d'abeille qui s'illumine en ondes autour de la souris */
  MODES.hex = {
    name: "Nid d'abeille", desc: "Grille hexagonale façon interface sci-fi, ondes lumineuses et cellules qui s'allument",
    init(E) {
      const S = 22, w = Math.sqrt(3) * S, h = 1.5 * S, cells = [];
      for (let r = -1; r * h < E.H + S * 2; r++) for (let q = -1; q * w < E.W + w; q++) cells.push({ x: q * w + (r % 2 ? w / 2 : 0), y: r * h, f: 0 });
      const hex = (c, x, y, s) => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = TAU / 6 * i + Math.PI / 6; c.lineTo(x + s * Math.cos(a), y + s * Math.sin(a)); } c.closePath(); };
      let t = 0, wave = { x: E.W / 2, y: E.H / 2, t: 0 };
      return {
        draw(dt) {
          const { ctx, W, H, mouse } = E;
          t += dt; wave.t += dt;
          if (wave.t > 4.5) wave = { x: rand(0, W), y: rand(0, H), t: 0 };      // une onde part d'un point au hasard
          if (Math.random() < dt * 3) cells[(Math.random() * cells.length) | 0].f = 1;  // cellules qui clignotent
          ctx.clearRect(0, 0, W, H);
          ctx.lineWidth = 1;
          for (const c of cells) {
            const dm = Math.hypot(c.x - mouse.x, c.y - mouse.y);
            const near = dm < 220 ? (1 - dm / 220) : 0;
            const dw = Math.hypot(c.x - wave.x, c.y - wave.y), ring = Math.max(0, 1 - Math.abs(dw - wave.t * 260) / 60) * Math.max(0, 1 - wave.t / 4.5);
            const glow = Math.min(1, near * 0.9 + ring * 0.7 + c.f);
            hex(ctx, c.x, c.y, S - 2.5);
            if (glow > 0.02) { ctx.fillStyle = rgba(c.f > near ? E.c2 : E.c1, glow * (E.light ? 0.18 : 0.16)); ctx.fill(); }
            ctx.strokeStyle = rgba(E.c1, (E.light ? 0.13 : 0.09) + glow * 0.5); ctx.stroke();
            c.f = Math.max(0, c.f - dt * 0.8);
          }
        },
      };
    },
  };

  /* 8. Champ de flux : des milliers de traits qui suivent un courant invisible (art génératif) */
  MODES.flow = {
    name: "Champ de flux", desc: "Art génératif : des traits fins qui suivent un courant invisible et laissent des traînées",
    init(E) {
      const N = Math.round((E.W * E.H) / 1800);
      const P = Array.from({ length: N }, () => ({ x: rand(0, E.W), y: rand(0, E.H), life: rand(0, 200), c: Math.random() < 0.3 }));
      let t = 0;
      const field = (x, y) => Math.sin(x * 0.0042 + t * 0.15) * 1.6 + Math.cos(y * 0.005 - t * 0.12) * 1.6 + Math.sin((x + y) * 0.0021 + t * 0.07);
      E.ctx.clearRect(0, 0, E.W, E.H);
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          if (!dt) return;
          t += dt;
          ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,.05)"; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = "source-over"; ctx.lineWidth = 1;
          for (const p of P) {
            const a = field(p.x, p.y), nx = p.x + Math.cos(a) * 55 * dt, ny = p.y + Math.sin(a) * 55 * dt;
            ctx.strokeStyle = rgba(p.c ? E.c2 : E.c1, E.light ? 0.35 : 0.3);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
            p.x = nx; p.y = ny; p.life -= dt * 30;
            if (p.life < 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = rand(0, W); p.y = rand(0, H); p.life = rand(80, 220); }
          }
        },
      };
    },
  };

  /* 9. Vague de points : une mer de points en 3D qui ondule (style Stripe / Vercel) */
  MODES.dotwave = {
    name: "Vague de points", desc: "Une mer de points en 3D qui ondule doucement, très « landing page tech »",
    init(E) {
      const NX = 70, NZ = 36;
      let t = 0;
      return {
        draw(dt) {
          const { ctx, W, H, mouse } = E;
          t += dt;
          ctx.clearRect(0, 0, W, H);
          const hz = H * 0.42, F = H * 0.9, mx = mouse.x > -500 ? (mouse.x / W - 0.5) : 0;
          for (let iz = NZ - 1; iz >= 0; iz--) {
            const z = 1.2 + iz * 0.22;
            for (let ix = 0; ix < NX; ix++) {
              const x = (ix - NX / 2) * 0.32;
              const y = Math.sin(ix * 0.22 + t * 1.1) * 0.35 + Math.cos(iz * 0.3 + t * 0.8) * 0.35 + Math.sin((ix + iz) * 0.12 - t * 0.6) * 0.25;
              const sx = W / 2 + ((x + mx * 2) / z) * F * 0.55, sy = hz + ((1.6 - y) / z) * F * 0.45;
              if (sx < -10 || sx > W + 10 || sy > H + 10) continue;
              const k = 1 - iz / NZ, hi = (y + 0.9) / 1.8;
              ctx.fillStyle = rgba(hi > 0.62 ? E.c2 : E.c1, (0.15 + k * 0.7) * (E.light ? 0.8 : 0.9));
              ctx.beginPath(); ctx.arc(sx, sy, 0.6 + k * 2.1, 0, TAU); ctx.fill();
            }
          }
        },
      };
    },
  };

  /* 10. Radar : balayage circulaire et cibles qui apparaissent (ambiance SOC / cyber) */
  MODES.radar = {
    name: "Radar", desc: "Écran radar façon centre de supervision : balayage, cibles détectées, quadrillage",
    init(E) {
      let ang = 0;
      const blips = [];
      return {
        draw(dt) {
          const { ctx, W, H } = E;
          ctx.clearRect(0, 0, W, H);
          const cx = W * 0.7, cy = H * 0.52, R = Math.max(W, H) * 0.55;
          ctx.lineWidth = 1;
          for (let r = 70; r < R; r += 70) { ctx.strokeStyle = rgba(E.c1, E.light ? 0.16 : 0.12); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }
          for (let a = 0; a < 12; a++) { const th = (TAU / 12) * a; ctx.strokeStyle = rgba(E.c1, 0.07); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(th) * R, cy + Math.sin(th) * R); ctx.stroke(); }
          // graduations
          for (let a = 0; a < 72; a++) { const th = (TAU / 72) * a, r0 = 280, r1 = a % 6 ? 288 : 298; ctx.strokeStyle = rgba(E.c1, 0.3); ctx.beginPath(); ctx.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0); ctx.lineTo(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1); ctx.stroke(); }
          const prev = ang; ang = (ang + dt * 1.1) % TAU;
          // faisceau avec traînée
          if (ctx.createConicGradient) {
            const g = ctx.createConicGradient(ang - 1.1, cx, cy);
            g.addColorStop(0, rgba(E.c1, 0)); g.addColorStop(1.1 / TAU, rgba(E.c1, E.light ? 0.22 : 0.26)); g.addColorStop(1.1 / TAU + 0.001, rgba(E.c1, 0)); g.addColorStop(1, rgba(E.c1, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
          }
          ctx.strokeStyle = rgba(E.c1, 0.75); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();
          // le faisceau « détecte » des cibles
          if (Math.random() < dt * 2.2) { const r = rand(60, R * 0.8); blips.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, a: 1, c: Math.random() < 0.3 }); }
          for (let i = blips.length - 1; i >= 0; i--) {
            const b = blips[i]; b.a -= dt * 0.35;
            if (b.a <= 0) { blips.splice(i, 1); continue; }
            const col = b.c ? E.c2 : E.c1;
            const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 12); g.addColorStop(0, rgba(col, b.a * 0.8)); g.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, 12, 0, TAU); ctx.fill();
            ctx.strokeStyle = rgba(col, b.a * 0.7); ctx.beginPath(); ctx.arc(b.x, b.y, 4 + (1 - b.a) * 18, 0, TAU); ctx.stroke();
          }
          void prev;
        },
      };
    },
  };

  /* ============================ Fond de l'accueil ============================ */
  const KEY = "cw.bgMode";
  const getMode = () => { try { const m = JSON.parse(localStorage.getItem(KEY)); return MODES[m] ? m : "warp"; } catch { return "warp"; } };

  function home(canvas) {
    const ctx = canvas.getContext("2d");
    const E = { ctx, W: 0, H: 0, dpr: 1, c1: "", c2: "", base: "", light: false, mouse: { x: -999, y: -999 } };
    let mode = getMode(), inst = null;
    function colors() {
      E.c1 = css("--net", "110,255,205"); E.c2 = css("--net2", "34,211,238");
      E.light = document.documentElement.dataset.theme !== "dark";
      const m = getComputedStyle(canvas.parentElement).backgroundColor.match(/\d+/g);
      E.base = m ? m.slice(0, 3).join(",") : (E.light ? "242,245,249" : "5,8,13");
    }
    function build() {
      ({ w: E.W, h: E.H, dpr: E.dpr } = fit(canvas, ctx));
      colors();
      canvas.parentElement.dataset.mode = mode;
      inst = MODES[mode].init(E);
      inst.draw(0.016);
    }
    const running = () => !document.hidden && !reduce.matches && !document.body.classList.contains("editing");
    const L = loop((dt) => inst && inst.draw(dt), 30, running);
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); L.sync(); }, 150); });
    window.addEventListener("mousemove", (e) => { E.mouse.x = e.clientX; E.mouse.y = e.clientY; }, { passive: true });
    document.addEventListener("mouseleave", () => { E.mouse.x = E.mouse.y = -999; });
    new MutationObserver(() => { build(); L.sync(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-user"] });
    new MutationObserver(() => L.sync()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    build(); L.sync();
    return {
      set(m) { if (!MODES[m]) return; mode = m; try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {} build(); L.sync(); },
      get: () => mode,
      jump() { inst?.jump?.(); L.sync(); },
    };
  }

  /* ============================== MATRIX (connexion) ============================== */
  function matrix(canvas, getColor) {
    const ctx = canvas.getContext("2d");
    const CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF{}<>$#/\\=+*";
    const FS = 16;
    let W = 0, H = 0, drops = [], speed = [];
    function build() {
      ({ w: W, h: H } = fit(canvas, ctx));
      const cols = Math.ceil(W / FS);
      drops = Array.from({ length: cols }, () => -Math.random() * (H / FS) * 1.2);
      speed = Array.from({ length: cols }, () => 0.45 + Math.random() * 0.9);
      ctx.fillStyle = "#02050a"; ctx.fillRect(0, 0, W, H);
    }
    function draw(dt) {
      if (!dt) return;
      const col = getColor();
      ctx.fillStyle = "rgba(2,5,10,.12)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = `600 ${FS}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * FS, x = i * FS;
        ctx.fillStyle = "rgba(230,255,245,.95)"; ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0], x, y);
        ctx.fillStyle = rgba(col, 0.85); ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0], x, y - FS);
        drops[i] += speed[i] * dt * 22;
        if (y > H && Math.random() > 0.975) { drops[i] = -Math.random() * 20; speed[i] = 0.45 + Math.random() * 0.9; }
      }
    }
    build();
    const L = loop(draw, 24, () => !document.hidden && !reduce.matches);
    const onResize = () => build();
    window.addEventListener("resize", onResize);
    L.sync();
    return () => { L.stop(); window.removeEventListener("resize", onResize); };
  }

  window.CW_FX = { matrix, MODES };
  const bg = document.getElementById("bgCanvas");
  if (bg && bg.getContext) window.CW_FX.home = home(bg);
})();
