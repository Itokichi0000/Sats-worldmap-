/**
 * effects.js — スクリーンの演出（画面いっぱいの canvas と、効果音）
 *   SM.fx.spark(x, y)       ぱちっ（小さな火花）
 *   SM.fx.bolt(x, y)        空からの稲妻
 *   SM.fx.fireworks(x, y)   花火
 *   SM.fx.confetti()        紙吹雪（上から）
 *   SM.fx.shake()           画面をゆらす
 *   SM.fx.banner(html, kind) 真ん中に大きな札
 *   SM.sound.play(name)     ぴっ・ばりっ・どーん・ファンファーレ（WebAudio で作る。音のファイルはない）
 * 「視差効果を減らす」がオンなら、動きを小さくする。
 */
window.SM = window.SM || {};

(function (SM) {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLORS = ["#ffb84d", "#f7931a", "#ffd166", "#ff6b6b", "#4dd0e1", "#b388ff", "#ffffff"];

  let canvas, ctx, raf = 0;
  const parts = []; // { x, y, vx, vy, life, max, color, size, g, kind }
  const bolts = []; // { pts, life }

  function ensure() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "fx-canvas";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener("resize", size);
  }

  function loop() {
    raf = 0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= 1;
      const a = Math.max(0, b.life / b.max);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = "#fff6d5";
      ctx.shadowColor = "#ffb84d";
      ctx.shadowBlur = 24;
      ctx.lineWidth = 4;
      ctx.beginPath();
      b.pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
      if (b.flash && b.life > b.max - 4) {
        ctx.fillStyle = `rgba(255,240,200,${0.18 * a})`;
        ctx.fillRect(0, 0, innerWidth, innerHeight);
      }
      if (b.life <= 0) bolts.splice(i, 1);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= 1;
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "confetti") p.rot += p.vr;
      const a = Math.max(0, Math.min(1, p.life / (p.max * 0.4)));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === "confetti") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.life <= 0 || p.y > innerHeight + 40) parts.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    if (parts.length || bolts.length) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function burst(x, y, n, speed, opts = {}) {
    ensure();
    const count = reduce ? Math.ceil(n / 4) : n;
    const color = opts.color;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      parts.push({
        x, y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v,
        life: 40 + Math.random() * 30,
        max: 70,
        color: color || COLORS[(Math.random() * COLORS.length) | 0],
        size: (opts.size || 2.5) * (0.6 + Math.random() * 0.8),
        g: opts.g ?? 0.06,
        drag: 0.97,
        kind: "dot",
      });
    }
    kick();
  }

  const fx = {
    spark(x, y) {
      burst(x, y, 26, 4, { size: 2.2, color: "#ffd166" });
    },
    bolt(x, y) {
      ensure();
      const pts = [[x + (Math.random() - 0.5) * 120, -10]];
      const steps = 12;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = pts[0][0] + (x - pts[0][0]) * t + (Math.random() - 0.5) * 60;
        pts.push([px, -10 + (y + 10) * t]);
      }
      pts.push([x, y]);
      bolts.push({ pts, life: reduce ? 6 : 16, max: reduce ? 6 : 16, flash: true });
      burst(x, y, 50, 6, { size: 2.6 });
      kick();
    },
    fireworks(x, y, rounds = 4) {
      fx.bolt(x, y);
      if (reduce) return;
      for (let i = 0; i < rounds; i++) {
        setTimeout(() => {
          const fxX = x + (Math.random() - 0.5) * innerWidth * 0.5;
          const fxY = Math.max(80, y - 80 - Math.random() * innerHeight * 0.35);
          burst(fxX, fxY, 90, 7, { size: 2.8, color: COLORS[(Math.random() * COLORS.length) | 0] });
          SM.sound.play("boom");
        }, 250 + i * 380);
      }
    },
    confetti(n = 220) {
      ensure();
      const count = reduce ? 40 : n;
      for (let i = 0; i < count; i++) {
        parts.push({
          x: Math.random() * innerWidth,
          y: -20 - Math.random() * innerHeight * 0.5,
          vx: (Math.random() - 0.5) * 2,
          vy: 2 + Math.random() * 3,
          life: 260,
          max: 260,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          size: 4 + Math.random() * 4,
          g: 0.02,
          drag: 0.995,
          kind: "confetti",
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 0.3,
        });
      }
      kick();
    },
    shake() {
      if (reduce) return;
      const el = document.getElementById("app");
      if (!el) return;
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    },
    /** kind: "info" | "big" | "whale" | "goal" */
    banner(html, kind = "info", ms = 2600) {
      const el = document.createElement("div");
      el.className = `fx-banner fx-${kind}`;
      el.innerHTML = html;
      document.body.appendChild(el);
      setTimeout(() => el.classList.add("out"), ms);
      setTimeout(() => el.remove(), ms + 600);
    },
  };

  // ── 効果音（WebAudio で作る） ────────────────────────────────
  let ac = null;
  let enabled = true;
  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    return ac;
  }
  function tone(freq, start, dur, type = "sine", gain = 0.15, slideTo) {
    const a = audio();
    const t = a.currentTime + start;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(start, dur, gain = 0.2, lowpass = 1200) {
    const a = audio();
    const t = a.currentTime + start;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }
  const SOUNDS = {
    pip() { tone(1320, 0, 0.12, "triangle", 0.12); tone(1760, 0.06, 0.14, "triangle", 0.1); },
    zap() { noise(0, 0.25, 0.25, 4000); tone(880, 0, 0.3, "sawtooth", 0.06, 110); },
    boom() { noise(0, 0.8, 0.35, 500); tone(90, 0, 0.6, "sine", 0.2, 40); },
    fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.22, "square", 0.07)); },
    combo() { tone(660, 0, 0.08, "square", 0.06); tone(990, 0.07, 0.12, "square", 0.06); },
    gong() { tone(196, 0, 1.6, "sine", 0.25); tone(294, 0, 1.4, "sine", 0.12); },
  };
  const sound = {
    set enabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    /** ブラウザは、画面を一度押すまで音を出させない */
    get blocked() { return !!ac && ac.state === "suspended"; },
    unlock() {
      const a = audio();
      if (a && a.state === "suspended") a.resume();
    },
    play(name) {
      if (!enabled || !SOUNDS[name]) return;
      const a = audio();
      if (!a) return;
      if (a.state === "suspended") a.resume().catch(() => {});
      try { SOUNDS[name](); } catch (e) { /* 鳴らせない */ }
    },
  };

  SM.fx = fx;
  SM.sound = sound;
})(window.SM);
