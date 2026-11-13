/* Fond animé : réseau de points reliés (façon topologie réseau) qui dérive lentement.
   Léger : ~30 images/s, mis en pause quand l'onglet est caché ou pendant l'édition,
   image fixe si l'utilisateur préfère réduire les animations. */
"use strict";

(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const LINK = 150;          // distance max (px) pour relier deux points
  let W = 0, H = 0, dpr = 1, nodes = [], rgb = "110,255,205", raf = 0, last = 0;
  const mouse = { x: -9999, y: -9999 };

  function readColor() {
    rgb = getComputedStyle(document.documentElement).getPropertyValue("--net").trim() || rgb;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.max(18, Math.min(90, Math.round((W * H) / 21000)));
    while (nodes.length < n) nodes.push(makeNode());
    nodes.length = n;
    draw();
  }

  function makeNode() {
    const a = Math.random() * Math.PI * 2, v = 0.06 + Math.random() * 0.16;
    return { x: Math.random() * W, y: Math.random() * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.8 + Math.random() * 1.5, big: Math.random() < 0.12 };
  }

  function step(dt) {
    for (const p of nodes) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > LINK * LINK) continue;
        const o = (1 - Math.sqrt(d2) / LINK) * 0.34;
        ctx.strokeStyle = `rgba(${rgb},${o.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // liaison douce vers le curseur
      const mx = a.x - mouse.x, my = a.y - mouse.y, md = Math.hypot(mx, my);
      if (md < 190) {
        ctx.strokeStyle = `rgba(${rgb},${((1 - md / 190) * 0.5).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }
    for (const p of nodes) {
      if (p.big) {
        ctx.fillStyle = `rgba(${rgb},.14)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = `rgba(${rgb},${p.big ? 0.95 : 0.6})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = t - last;
    if (dt < 32) return;                 // ~30 images/s
    last = t;
    step(Math.min(dt, 80) / 16.7);
    draw();
  }
  const shouldRun = () => !document.hidden && !reduce.matches && !document.body.classList.contains("editing");
  function sync() {
    cancelAnimationFrame(raf); raf = 0;
    if (shouldRun()) { last = performance.now(); raf = requestAnimationFrame(frame); } else draw();
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener("mouseleave", () => { mouse.x = mouse.y = -9999; });
  document.addEventListener("visibilitychange", sync);
  reduce.addEventListener?.("change", sync);
  // Changement de thème ou passage tableau de bord ↔ éditeur
  new MutationObserver(() => { readColor(); sync(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  readColor();
  resize();
  sync();
})();
