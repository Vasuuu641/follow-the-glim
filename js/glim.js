// Glim: a fairy made of light. No drawing, just glow.
const Glim = (() => {
  const canvas = document.getElementById('fx');
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Pre-rendered soft glow sprites (much cheaper than gradients every frame)
  function makeSprite(r, g, b) {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d');
    const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 64);
    return s;
  }
  const SPRITE = {
    gold: makeSprite(255, 217, 120),
    teal: makeSprite(111, 242, 224),
    white: makeSprite(255, 255, 255),
  };

  // ---------- State ----------
  const pos = { x: w / 2, y: h / 2 };
  const target = { x: w / 2, y: h / 2 };
  let mode = 'mouse';        // 'mouse' (follows cursor, wanders when idle) or 'free' (flies to target)
  let lastMove = 0;
  let particles = [];
  let t = 0;
  let last = performance.now();
  let running = false;

  window.addEventListener('mousemove', (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
    lastMove = performance.now();
  });

  function emit(x, y, vx, vy, life, size, sprite) {
    if (particles.length > 700) return;
    particles.push({ x, y, vx, vy, life, max: life, size, sprite });
  }

  // ---------- Main loop ----------
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;

    // Where is Glim heading?
    let tx = target.x, ty = target.y;
    if (mode === 'mouse' && now - lastMove > 2500) {
      // idle: drift in a lazy figure-eight around the screen
      tx = w / 2 + Math.sin(t * 0.6) * w * 0.28;
      ty = h / 2 + Math.sin(t * 0.9 + 1) * h * 0.2;
    }

    const px = pos.x, py = pos.y;
    const k = 1 - Math.exp(-dt * 3.5);
    pos.x += (tx - pos.x) * k;
    pos.y += (ty - pos.y) * k;
    const speed = Math.hypot(pos.x - px, pos.y - py);

    // Tiny hover wobble
    const gx = pos.x + Math.sin(t * 5) * 3;
    const gy = pos.y + Math.cos(t * 4.3) * 3;

    // Pixie dust trail: more dust when she moves fast
    const count = 2 + Math.min(Math.floor(speed * 0.4), 6);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 30;
      emit(
        gx + (Math.random() - 0.5) * 8,
        gy + (Math.random() - 0.5) * 8,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        0.6 + Math.random() * 0.9,
        6 + Math.random() * 10,
        Math.random() < 0.7 ? SPRITE.gold : SPRITE.teal
      );
    }

    // Update particles
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 22 * dt;                       // gentle fall
      const drag = 1 - 1.4 * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    // ---------- Draw ----------
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter'; // additive = real glow

    for (const p of particles) {
      const a = p.life / p.max;
      const s = p.size * (0.4 + 0.6 * a);
      ctx.globalAlpha = a * a;
      ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
    }

    // Glim herself
    const pulse = 1 + Math.sin(t * 3) * 0.12;
    ctx.globalAlpha = 0.18;
    ctx.drawImage(SPRITE.teal, gx - 85, gy - 85, 170, 170);
    ctx.globalAlpha = 0.6;
    const hs = 110 * pulse;
    ctx.drawImage(SPRITE.gold, gx - hs / 2, gy - hs / 2, hs, hs);
    ctx.globalAlpha = 1;
    ctx.drawImage(SPRITE.white, gx - 14, gy - 14, 28, 28);

    // Three sparks orbiting her core (the "flutter")
    for (let i = 0; i < 3; i++) {
      const a = t * 3.2 + i * 2.094;
      const r = 20 + Math.sin(t * 4 + i) * 6;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(SPRITE.teal, gx + Math.cos(a) * r - 5, gy + Math.sin(a) * r * 0.6 - 5, 10, 10);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }

  // ---------- Public API ----------
  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    },
    stop() { running = false; },
    followMouse() { mode = 'mouse'; },
    flyTo(x, y) { mode = 'free'; target.x = x; target.y = y; },
    getPos() { return { x: pos.x, y: pos.y }; },
    burst(x, y, n = 60) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 260;
        emit(
          x, y,
          Math.cos(a) * sp, Math.sin(a) * sp,
          0.8 + Math.random() * 1.2,
          8 + Math.random() * 18,
          Math.random() < 0.6 ? SPRITE.gold : SPRITE.teal
        );
      }
    },
  };
})();