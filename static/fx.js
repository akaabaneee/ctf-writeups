/* Effets de fond (canvas, aucune dépendance)
   - circuit : pistes de circuit imprimé + impulsions de données qui circulent, pistes éclairées sous la souris
   - matrix  : pluie de caractères façon Matrix (écran de connexion)
   ~30 images/s, en pause si l'onglet est caché, image fixe si l'utilisateur préfère réduire les animations. */
"use strict";

(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const rgba = (rgb, a) => `rgba(${rgb},${a})`;

  /* Boucle d'animation commune : appelle draw(dt) ~fps fois par seconde tant que active() */
  function loop(draw, fps, active) {
    let raf = 0, last = 0;
    const frame = (t) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 1000 / fps) return;
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

  /* ============================== CIRCUIT ============================== */
  function circuit(canvas) {
    const ctx = canvas.getContext("2d");
    const CELL = 26;
    const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    let W = 0, H = 0, dpr = 1, traces = [], pulses = [], base = null, bright = null, c1 = "", c2 = "", light = false;
    const mouse = { x: -999, y: -999, sx: -999, sy: -999 };
    const lens = document.createElement("canvas"), lctx = lens.getContext("2d");
    const R = 190;   // rayon de la zone éclairée par la souris

    function colors() {
      c1 = css("--net", "110,255,205");
      c2 = css("--net2", "34,211,238");
      light = document.documentElement.dataset.theme !== "dark";
    }

    function build() {
      ({ w: W, h: H, dpr } = fit(canvas, ctx));
      const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
      const used = new Set();
      traces = [];
      const target = Math.round((W * H) / 9000);
      for (let n = 0, tries = 0; n < target && tries < target * 6; tries++) {
        let x = Math.floor(Math.random() * cols), y = Math.floor(Math.random() * rows);
        if (used.has(x + "," + y)) continue;
        let d = Math.floor(Math.random() * 4) * 2;            // départ horizontal ou vertical
        const pts = [[x, y]]; used.add(x + "," + y);
        const len = 4 + Math.floor(Math.random() * 16);
        for (let i = 0; i < len; i++) {
          if (Math.random() < 0.22) d = (d + (Math.random() < 0.5 ? 1 : 7)) % 8;  // virage à 45°
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || used.has(nx + "," + ny)) break;
          x = nx; y = ny; used.add(x + "," + y);
          pts.push([x, y]);
        }
        if (pts.length < 3) continue;
        const P = pts.map(([a, b]) => [a * CELL + 0.5, b * CELL + 0.5]);
        const cum = [0];
        for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
        traces.push({ P, cum, total: cum[cum.length - 1], glow: 0 });
        n++;
      }
      render();
      pulses = [];
      for (let i = 0; i < Math.max(8, traces.length / 7); i++) spawn(true);
    }

    // Pré-dessine les pistes : une version discrète (fond) et une version vive (sous la souris)
    function paint(c, a, lw) {
      c.lineCap = "round"; c.lineJoin = "round";
      for (const t of traces) {
        c.strokeStyle = rgba(c1, a); c.lineWidth = lw;
        c.beginPath(); c.moveTo(t.P[0][0], t.P[0][1]);
        for (let i = 1; i < t.P.length; i++) c.lineTo(t.P[i][0], t.P[i][1]);
        c.stroke();
        // pastilles aux extrémités (« vias »)
        for (const [px, py] of [t.P[0], t.P[t.P.length - 1]]) {
          c.beginPath(); c.arc(px, py, 2.6, 0, Math.PI * 2);
          c.fillStyle = light ? "rgba(255,255,255,.9)" : "rgba(4,8,12,.9)"; c.fill();
          c.strokeStyle = rgba(c1, a * 1.6); c.lineWidth = 1.2; c.stroke();
        }
      }
    }
    function render() {
      const mk = () => { const o = document.createElement("canvas"); o.width = canvas.width; o.height = canvas.height; const c = o.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); return [o, c]; };
      let c; [base, c] = mk(); paint(c, light ? 0.16 : 0.13, 1.1);
      [bright, c] = mk(); paint(c, light ? 0.6 : 0.55, 1.4);
      lens.width = lens.height = Math.ceil(R * 2 * dpr);
    }

    function spawn(randomStart) {
      if (!traces.length) return;
      const t = traces[Math.floor(Math.random() * traces.length)];
      const rev = Math.random() < 0.5;
      pulses.push({ t, d: randomStart ? Math.random() * t.total : 0, rev, v: 70 + Math.random() * 110, cyan: Math.random() < 0.35, tail: 34 + Math.random() * 40 });
    }

    function at(t, dist) {
      dist = Math.max(0, Math.min(t.total, dist));
      let i = 1; while (i < t.cum.length - 1 && t.cum[i] < dist) i++;
      const a = t.P[i - 1], b = t.P[i], seg = t.cum[i] - t.cum[i - 1] || 1, k = (dist - t.cum[i - 1]) / seg;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }

    function draw(dt) {
      ctx.clearRect(0, 0, W, H);
      if (base) ctx.drawImage(base, 0, 0, W, H);
      // lentille : les pistes s'illuminent autour du curseur (suivi amorti)
      mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 8 || 1);
      mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 8 || 1);
      if (bright && mouse.sx > -R && mouse.sx < W + R) {
        const L = R * 2 * dpr;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = "source-over";
        lctx.clearRect(0, 0, L, L);
        lctx.drawImage(bright, (mouse.sx - R) * dpr, (mouse.sy - R) * dpr, L, L, 0, 0, L, L);
        lctx.globalCompositeOperation = "destination-in";
        const g = lctx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
        g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
        lctx.fillStyle = g; lctx.fillRect(0, 0, L, L);
        ctx.drawImage(lens, mouse.sx - R, mouse.sy - R, R * 2, R * 2);
      }
      // impulsions
      ctx.lineCap = "round";
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.d += p.v * dt;
        if (p.d - p.tail > p.t.total) { pulses.splice(i, 1); p.t.glow = 1; spawn(false); continue; }
        const col = p.cyan ? c2 : c1;
        const head = p.rev ? p.t.total - p.d : p.d;
        const STEPS = 8;
        for (let s = 0; s < STEPS; s++) {
          const d0 = p.d - (p.tail * s) / STEPS, d1 = p.d - (p.tail * (s + 1)) / STEPS;
          if (d1 > p.t.total || d0 < 0) continue;
          const [x0, y0] = at(p.t, p.rev ? p.t.total - d0 : d0), [x1, y1] = at(p.t, p.rev ? p.t.total - d1 : d1);
          ctx.strokeStyle = rgba(col, (1 - s / STEPS) * (light ? 0.75 : 0.85));
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        if (p.d <= p.t.total) {
          const [hx, hy] = at(p.t, head);
          const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 10);
          g.addColorStop(0, rgba(col, light ? 0.55 : 0.7)); g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = light ? rgba(col, 1) : "rgba(255,255,255,.95)";
          ctx.beginPath(); ctx.arc(hx, hy, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
      // l'extrémité atteinte par une impulsion clignote un instant
      for (const t of traces) {
        if (t.glow <= 0) continue;
        const [ex, ey] = t.P[t.P.length - 1], [sx, sy] = t.P[0];
        for (const [x, y] of [[ex, ey], [sx, sy]]) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
          g.addColorStop(0, rgba(c1, t.glow * 0.6)); g.addColorStop(1, rgba(c1, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
        }
        t.glow = Math.max(0, t.glow - dt * 1.4);
      }
    }

    const running = () => !document.hidden && !reduce.matches && !document.body.classList.contains("editing");
    const L = loop(draw, 30, running);
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); L.sync(); }, 150); });
    window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; if (mouse.sx < -900) { mouse.sx = mouse.x; mouse.sy = mouse.y; } }, { passive: true });
    document.addEventListener("mouseleave", () => { mouse.x = mouse.y = -999; });
    const recolor = () => { colors(); render(); L.sync(); };
    new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-user"] });
    new MutationObserver(() => L.sync()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    colors(); build(); L.sync();
  }

  /* ============================== MATRIX ============================== */
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
      ctx.fillStyle = "rgba(2,5,10,.12)";           // traînée qui s'efface
      ctx.fillRect(0, 0, W, H);
      ctx.font = `600 ${FS}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * FS, x = i * FS;
        const ch = CHARS[(Math.random() * CHARS.length) | 0];
        // tête claire, puis caractère coloré juste derrière
        ctx.fillStyle = "rgba(230,255,245,.95)"; ctx.fillText(ch, x, y);
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

  window.CW_FX = { matrix };
  const bg = document.getElementById("bgCanvas");
  if (bg && bg.getContext) circuit(bg);
})();
