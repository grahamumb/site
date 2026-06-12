/*
 * physics.js — hand-rolled 2D physics for the Home tab. Zero dependencies.
 *
 * One axis-aligned rectangle per post falls under gravity into a bowl-shaped
 * container (a parabola), collides with the bowl walls and with other boxes,
 * and settles into a pile. Clicking a box opens that post.
 *
 * Exposes window.Sim = { start(canvas, posts, onClick), stop() }.
 */
window.Sim = (function () {
  // --- Tunables ---
  const GRAVITY = 2200;        // px/s^2
  const DT = 1 / 120;          // fixed physics timestep
  const MAX_SUB = 5;           // max substeps per frame (avoids spiral of death)
  const REST = 0.15;           // wall/bounds restitution (bounciness)
  const WALL_FRICTION = 0.86;  // tangential damping on wall contact
  const BOX_H = 36;
  const PAD_X = 18;
  const FONT_PX = 15;
  const FONT = FONT_PX + 'px system-ui, -apple-system, Segoe UI, sans-serif';
  const SPAWN_GAP = 0.32;      // seconds between drops
  const SLEEP_V = 5;           // speed under which we bleed off velocity

  let canvas, ctx, dpr = 1, W = 0, H = 0;
  let boxes = [], pending = [], bowl = null, onClick = null;
  let raf = null, last = 0, acc = 0, spawnTimer = 0;
  const mouse = { x: -1, y: -1 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // --- Geometry -----------------------------------------------------------
  function makeBowl(w, h) {
    const cx = w / 2;
    const halfW = Math.min(w * 0.42, 440);
    const topY = h * 0.30;
    const baseY = Math.min(h * 0.92, topY + halfW * 0.85);
    const k = (baseY - topY) / (halfW * halfW); // y = baseY - k*(x-cx)^2
    const pts = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const x = cx - halfW + (2 * halfW) * (i / N);
      pts.push({ x, y: baseY - k * (x - cx) * (x - cx) });
    }
    return {
      cx, halfW, topY, baseY, k, pts,
      f(x) { return baseY - k * (x - cx) * (x - cx); },
      normal(x) {
        const m = -2 * k * (x - cx);      // slope dy/dx
        const len = Math.hypot(m, 1);     // inward/up normal = (m, -1) normalized
        return { x: m / len, y: -1 / len };
      },
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;
    bowl = makeBowl(W, H);
  }

  function makeBox(post) {
    ctx.font = FONT;
    const maxW = Math.max(60, bowl.halfW * 1.7);
    let w = Math.min(ctx.measureText(post.title).width + PAD_X * 2, maxW);
    return {
      title: post.title, slug: post.slug,
      w, h: BOX_H,
      x: bowl.cx + (Math.random() - 0.5) * bowl.halfW * 1.2,
      y: -BOX_H - Math.random() * 80,
      vx: (Math.random() - 0.5) * 60, vy: 0,
      hue: 200 + Math.random() * 130,
    };
  }

  // --- Collision resolution ----------------------------------------------
  // Equal-mass, axis-aligned boxes. Min-penetration-axis separation with a
  // fully-inelastic velocity merge on that axis (stable for stacking).
  function resolveBoxes(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const px = (a.w + b.w) / 2 - Math.abs(dx);
    const py = (a.h + b.h) / 2 - Math.abs(dy);
    if (px <= 0 || py <= 0) return;
    if (px < py) {
      const s = dx < 0 ? -1 : 1, corr = px / 2;
      a.x -= s * corr; b.x += s * corr;
      const avg = (a.vx + b.vx) / 2;
      a.vx = avg; b.vx = avg;
    } else {
      const s = dy < 0 ? -1 : 1, corr = py / 2;
      a.y -= s * corr; b.y += s * corr;
      const avg = (a.vy + b.vy) / 2;
      a.vy = avg; b.vy = avg;
      a.vx *= 0.92; b.vx *= 0.92; // friction so stacked boxes stop sliding
    }
  }

  function resolveBowl(b) {
    const hw = b.w / 2, hh = b.h / 2;
    const bottom = b.y + hh;
    let maxPen = 0, atX = b.x;
    for (const px of [b.x - hw, b.x, b.x + hw]) {
      const sx = clamp(px, bowl.cx - bowl.halfW, bowl.cx + bowl.halfW);
      const pen = bottom - bowl.f(sx);
      if (pen > maxPen) { maxPen = pen; atX = sx; }
    }
    if (maxPen > 0) {
      const n = bowl.normal(atX);
      b.x += n.x * maxPen;
      b.y += n.y * maxPen;
      const vn = b.vx * n.x + b.vy * n.y;
      if (vn < 0) {
        b.vx -= (1 + REST) * vn * n.x;
        b.vy -= (1 + REST) * vn * n.y;
      }
      b.vx *= WALL_FRICTION;
    }
  }

  function resolveBounds(b) {
    const hw = b.w / 2, hh = b.h / 2;
    if (b.x - hw < 0) { b.x = hw; if (b.vx < 0) b.vx *= -REST; }
    if (b.x + hw > W) { b.x = W - hw; if (b.vx > 0) b.vx *= -REST; }
    if (b.y + hh > H) { b.y = H - hh; if (b.vy > 0) b.vy *= -REST; b.vx *= WALL_FRICTION; }
  }

  // --- Step / render ------------------------------------------------------
  function step(dt) {
    if (pending.length) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) { boxes.push(makeBox(pending.shift())); spawnTimer = SPAWN_GAP; }
    }
    for (const b of boxes) {
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) resolveBoxes(boxes[i], boxes[j]);
      }
    }
    for (const b of boxes) { resolveBowl(b); resolveBounds(b); }
    for (const b of boxes) {
      if (Math.hypot(b.vx, b.vy) < SLEEP_V) { b.vx *= 0.6; b.vy *= 0.6; }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const pointInBox = (p, b) =>
    p.x >= b.x - b.w / 2 && p.x <= b.x + b.w / 2 && p.y >= b.y - b.h / 2 && p.y <= b.y + b.h / 2;

  function render() {
    ctx.clearRect(0, 0, W, H);
    // bowl
    ctx.beginPath();
    bowl.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3a4150';
    ctx.stroke();
    // boxes
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let hovering = false;
    for (const b of boxes) {
      const hot = pointInBox(mouse, b);
      if (hot) hovering = true;
      ctx.fillStyle = `hsl(${b.hue} 65% ${hot ? 62 : 52}%)`;
      roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 7);
      ctx.fill();
      ctx.fillStyle = '#0f1115';
      ctx.fillText(b.title, b.x, b.y + 1, b.w - PAD_X);
    }
    canvas.style.cursor = hovering ? 'pointer' : 'default';
  }

  function frame(t) {
    if (!last) last = t;
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.05) dt = 0.05;
    acc += dt;
    let sub = 0;
    while (acc >= DT && sub < MAX_SUB) { step(DT); acc -= DT; sub++; }
    render();
    raf = requestAnimationFrame(frame);
  }

  // --- Events -------------------------------------------------------------
  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onMove(e) { const p = toLocal(e); mouse.x = p.x; mouse.y = p.y; }
  function onLeave() { mouse.x = -1; mouse.y = -1; }
  function onCanvasClick(e) {
    const p = toLocal(e);
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (pointInBox(p, boxes[i])) { onClick(boxes[i].slug); return; }
    }
  }
  function onResize() { if (canvas) resize(); }

  // --- Public API ---------------------------------------------------------
  function start(c, posts, cb) {
    stop();
    canvas = c;
    ctx = canvas.getContext('2d');
    onClick = cb;
    resize();
    boxes = [];
    pending = (posts || []).slice();
    spawnTimer = 0;
    last = 0;
    acc = 0;
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onCanvasClick);
    window.addEventListener('resize', onResize);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (canvas) {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onCanvasClick);
    }
    window.removeEventListener('resize', onResize);
  }

  return { start, stop };
})();
