// Drawing only: the world's state and the current screen in, pixels out. The
// 1280x720 playfield is scaled to fit the window and centred, the margin filled
// with the backdrop colour. Neon glow is faked with layered strokes (no
// shadowBlur, which is slow), the starfield is fixed at boot so the backdrop
// never flickers, and text that holds a number is rebuilt only when it changes.

import { ENEMY, FIELD, FINAL_WAVE, PALETTE, UPGRADES } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_UPGRADE = 'upgrade';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const TAU = Math.PI * 2;

/** The upgrade cards' geometry, shared by drawUpgrade and choiceAt. */
const UPGRADE_CARD = { w: 300, h: 250, gap: 36, y: 190 };

/** Which upgrade card (0, 1 or 2) a field point is over, or -1 when none. */
export function choiceAt(x, y) {
  const totalW = UPGRADE_CARD.w * 3 + UPGRADE_CARD.gap * 2;
  const startX = (FIELD.width - totalW) / 2;
  for (let i = 0; i < 3; i += 1) {
    const cx = startX + i * (UPGRADE_CARD.w + UPGRADE_CARD.gap);
    if (x >= cx && x <= cx + UPGRADE_CARD.w && y >= UPGRADE_CARD.y && y <= UPGRADE_CARD.y + UPGRADE_CARD.h) return i;
  }
  return -1;
}

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };

  // Fixed starfield: 220 stars placed once with a tiny LCG, so the backdrop is
  // identical every frame and every run.
  const stars = [];
  let starSeed = 123456789;
  const nextStar = () => {
    starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
    return starSeed / 4294967296;
  };
  for (let i = 0; i < 220; i += 1) {
    stars.push({ x: nextStar() * FIELD.width, y: nextStar() * FIELD.height, r: 0.6 + nextStar() * 1.6, a: 0.25 + nextStar() * 0.6, tw: nextStar() * TAU });
  }

  const scoreLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const waveLabel = cachedLabel('WAVE ');
  const finalLabel = cachedLabel('SCORE ');
  const killsLabel = cachedLabel('KILLS ');
  const timeLabel = cachedLabel('TIME ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight, baseline) {
    const key = `${weight ?? 400}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight ?? 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline ?? 'alphabetic';
    context.fillText(value, x, y);
  }

  function roundRect(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function glowCircle(x, y, radius, color, alpha) {
    context.globalAlpha = alpha * 0.25;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius * 1.55, 0, TAU);
    context.fill();
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
    context.globalAlpha = 1;
  }

  function drawBackground(time) {
    context.fillStyle = PALETTE.field;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Nebulae: two slow-drifting radial gradients.
    const nx1 = 320 + Math.sin(time * 0.05) * 40;
    const ny1 = 180 + Math.cos(time * 0.04) * 30;
    let grad = context.createRadialGradient(nx1, ny1, 20, nx1, ny1, 420);
    grad.addColorStop(0, PALETTE.nebula1);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = grad;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    const nx2 = 1000 + Math.cos(time * 0.03) * 50;
    const ny2 = 540 + Math.sin(time * 0.045) * 30;
    grad = context.createRadialGradient(nx2, ny2, 20, nx2, ny2, 460);
    grad.addColorStop(0, PALETTE.nebula2);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = grad;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Grid.
    context.strokeStyle = PALETTE.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= FIELD.width; x += 64) {
      context.moveTo(x, 0);
      context.lineTo(x, FIELD.height);
    }
    for (let y = 0; y <= FIELD.height; y += 64) {
      context.moveTo(0, y);
      context.lineTo(FIELD.width, y);
    }
    context.stroke();
    // Stars, twinkling slowly.
    for (const s of stars) {
      context.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(time * 1.5 + s.tw));
      context.fillStyle = '#cfe4ff';
      context.beginPath();
      context.arc(s.x, s.y, s.r, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawPlayer(p, time) {
    const blink = p.invulnerable > 0 && Math.floor(time * 12) % 2 === 0;
    if (blink) return;
    context.save();
    context.translate(p.x, p.y);
    context.rotate(p.angle);
    // Engine glow and hull: a dart with a bright core.
    glowCircle(0, 0, p.radius, PALETTE.player, 0.9);
    context.fillStyle = PALETTE.player;
    context.beginPath();
    context.moveTo(p.radius + 10, 0);
    context.lineTo(-p.radius * 0.7, p.radius * 0.75);
    context.lineTo(-p.radius * 0.35, 0);
    context.lineTo(-p.radius * 0.7, -p.radius * 0.75);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.playerCore;
    context.beginPath();
    context.moveTo(p.radius * 0.4, 0);
    context.lineTo(-p.radius * 0.4, p.radius * 0.35);
    context.lineTo(-p.radius * 0.4, -p.radius * 0.35);
    context.closePath();
    context.fill();
    context.restore();
    if (p.shield) {
      context.strokeStyle = 'rgba(76, 201, 240, 0.8)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y, p.radius + 12 + Math.sin(time * 4) * 2, 0, TAU);
      context.stroke();
    }
    if (p.overcharge > 0) {
      context.strokeStyle = 'rgba(255, 230, 109, 0.7)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y, p.radius + 6, 0, TAU);
      context.stroke();
    }
  }

  function drawEnemy(e, time) {
    const def = ENEMY[e.kind];
    const color = def.color;
    context.save();
    context.translate(e.x, e.y);
    if (e.kind === 'chaser') {
      context.rotate(Math.atan2(e.vy, e.vx));
      glowCircle(0, 0, e.radius, color, 0.85);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(e.radius + 6, 0);
      context.lineTo(-e.radius * 0.8, e.radius * 0.8);
      context.lineTo(-e.radius * 0.8, -e.radius * 0.8);
      context.closePath();
      context.fill();
      context.fillStyle = '#ffd6dd';
      context.beginPath();
      context.arc(0, 0, e.radius * 0.25, 0, TAU);
      context.fill();
    } else if (e.kind === 'shooter') {
      // A spinning diamond with a bright core: reads at a glance, even small.
      context.rotate(time * 0.8);
      glowCircle(0, 0, e.radius, color, 0.85);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, -e.radius - 4);
      context.lineTo(e.radius + 4, 0);
      context.lineTo(0, e.radius + 4);
      context.lineTo(-e.radius - 4, 0);
      context.closePath();
      context.fill();
      context.fillStyle = '#fff3d6';
      context.beginPath();
      context.arc(0, 0, e.radius * 0.3, 0, TAU);
      context.fill();
    } else if (e.kind === 'splitter' || e.kind === 'shard') {
      context.rotate(time * 0.5);
      glowCircle(0, 0, e.radius, color, 0.85);
      context.fillStyle = color;
      context.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        const px = Math.cos(a) * e.radius;
        const py = Math.sin(a) * e.radius;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    } else if (e.kind === 'dasher') {
      const telegraph = e.state === 1;
      context.rotate(e.state === 1 || e.state === 2 ? e.angle : Math.atan2(e.vy, e.vx));
      if (telegraph) {
        context.globalAlpha = 0.5 + 0.5 * Math.sin(time * 30);
      }
      glowCircle(0, 0, e.radius, color, 0.9);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(e.radius + 8, 0);
      context.lineTo(-e.radius, e.radius * 0.7);
      context.lineTo(-e.radius * 0.4, 0);
      context.lineTo(-e.radius, -e.radius * 0.7);
      context.closePath();
      context.fill();
      context.fillStyle = '#dff7ff';
      context.beginPath();
      context.arc(0, 0, e.radius * 0.25, 0, TAU);
      context.fill();
      context.globalAlpha = 1;
    } else if (e.kind === 'orbiter') {
      context.rotate(time * 2);
      glowCircle(0, 0, e.radius, color, 0.85);
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, e.radius * 0.6, 0, TAU);
      context.stroke();
      context.fillStyle = color;
      context.beginPath();
      context.arc(0, 0, e.radius * 0.35, 0, TAU);
      context.fill();
    } else if (e.kind === 'tank') {
      context.rotate(time * 0.3);
      glowCircle(0, 0, e.radius, color, 0.85);
      context.fillStyle = color;
      context.fillRect(-e.radius * 0.8, -e.radius * 0.8, e.radius * 1.6, e.radius * 1.6);
      context.strokeStyle = 'rgba(255,255,255,0.5)';
      context.lineWidth = 2;
      context.strokeRect(-e.radius * 0.8, -e.radius * 0.8, e.radius * 1.6, e.radius * 1.6);
    } else if (e.kind === 'boss') {
      context.rotate(time * 0.4);
      glowCircle(0, 0, e.radius, color, 1);
      context.fillStyle = color;
      context.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU;
        const outer = i % 2 === 0 ? e.radius + 14 : e.radius * 0.72;
        const px = Math.cos(a) * outer;
        const py = Math.sin(a) * outer;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      context.fillStyle = '#1a0010';
      context.beginPath();
      context.arc(0, 0, e.radius * 0.42, 0, TAU);
      context.fill();
      context.fillStyle = '#ff8fa3';
      context.beginPath();
      context.arc(0, 0, e.radius * 0.42 * (0.7 + 0.3 * Math.sin(time * 5)), 0, TAU);
      context.fill();
    }
    context.restore();
    // Health bar for hurt tough enemies.
    if (e.maxHp > 60 && e.hp < e.maxHp) {
      const w = e.radius * 2;
      context.fillStyle = 'rgba(0,0,0,0.5)';
      context.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 5);
      context.fillStyle = '#ff4d6d';
      context.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 5);
    }
  }

  function drawField(state, time) {
    drawBackground(time);
    for (const p of state.pickups) {
      if (!p.active) continue;
      const bob = Math.sin(time * 3 + p.x) * 3;
      if (p.kind === 'health') {
        glowCircle(p.x, p.y + bob, 11, '#80ed99', 0.9);
        context.fillStyle = '#0a0a1e';
        context.fillRect(p.x - 2, p.y + bob - 7, 4, 14);
        context.fillRect(p.x - 7, p.y + bob - 2, 14, 4);
      } else if (p.kind === 'overcharge') {
        glowCircle(p.x, p.y + bob, 11, '#ffe66d', 0.9);
        context.fillStyle = '#0a0a1e';
        context.beginPath();
        context.moveTo(p.x + 2, p.y + bob - 9);
        context.lineTo(p.x - 5, p.y + bob + 1);
        context.lineTo(p.x, p.y + bob + 1);
        context.lineTo(p.x - 2, p.y + bob + 9);
        context.lineTo(p.x + 5, p.y + bob - 1);
        context.lineTo(p.x, p.y + bob - 1);
        context.closePath();
        context.fill();
      } else {
        context.save();
        context.translate(p.x, p.y + bob);
        context.rotate(time * 2);
        glowCircle(0, 0, 8, '#ffd60a', 0.9);
        context.fillStyle = '#ffd60a';
        context.beginPath();
        context.moveTo(0, -9);
        context.lineTo(7, 0);
        context.lineTo(0, 9);
        context.lineTo(-7, 0);
        context.closePath();
        context.fill();
        context.restore();
      }
    }
    for (const e of state.enemies) {
      if (e.active) drawEnemy(e, time);
    }
    drawPlayer(state.player, time);
    for (const b of state.bullets) {
      if (!b.active) continue;
      context.strokeStyle = PALETTE.bullet;
      context.lineWidth = b.radius * 1.6;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      context.lineTo(b.x, b.y);
      context.stroke();
      context.fillStyle = PALETTE.bulletCore;
      context.beginPath();
      context.arc(b.x, b.y, b.radius * 0.6, 0, TAU);
      context.fill();
    }
    for (const b of state.ebullets) {
      if (!b.active) continue;
      glowCircle(b.x, b.y, b.radius, '#ff4d6d', 0.95);
    }
    for (const p of state.particles) {
      if (!p.active) continue;
      context.globalAlpha = Math.max(0, p.life / p.maxLife);
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
    for (const f of state.floats) {
      if (!f.active) continue;
      context.globalAlpha = Math.max(0, f.life / f.maxLife);
      text(f.text, f.x, f.y, 15, f.color, 'center', 700);
    }
    context.globalAlpha = 1;
    if (state.flash > 0) {
      context.fillStyle = `rgba(255, 80, 100, ${state.flash * 0.55})`;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  function drawHud(state, best, screen) {
    text(scoreLabel(state.score), 24, 18, 30, PALETTE.text, 'left', 800, 'top');
    text(bestLabel(best), 24, 54, 16, PALETTE.muted, 'left', 600, 'top');
    const waveText = state.wave === 0 ? 'WAVE —' : `WAVE ${state.wave} / ${FINAL_WAVE}`;
    text(waveText, FIELD.width / 2, 18, 26, PALETTE.text, 'center', 800, 'top');
    // The upgrade screen has its own title at the top; the hostiles line would sit behind it.
    if (screen !== SCREEN_UPGRADE) {
      let alive = state.spawnQueue.length;
      for (const e of state.enemies) if (e.active) alive += 1;
      text(alive > 0 ? `${alive} HOSTILES` : 'SECTOR CLEAR', FIELD.width / 2, 50, 15, alive > 0 ? PALETTE.muted : PALETTE.hp, 'center', 700, 'top');
    }
    if (state.boss !== null && state.boss.active) {
      const w = 420;
      const x = (FIELD.width - w) / 2;
      const y = 76;
      text('VOID CORE', FIELD.width / 2, y - 2, 14, '#ff8fa3', 'center', 800, 'top');
      context.fillStyle = 'rgba(0,0,0,0.55)';
      context.fillRect(x, y + 16, w, 10);
      context.fillStyle = '#ff2e63';
      context.fillRect(x, y + 16, w * Math.max(0, state.boss.hp / state.boss.maxHp), 10);
      context.strokeStyle = 'rgba(255,46,99,0.6)';
      context.lineWidth = 1;
      context.strokeRect(x, y + 16, w, 10);
    }
    // Hull bar, top right. A backing plate first, so the cluster stays readable
    // when a bright enemy drifts behind it.
    const p = state.player;
    const barW = 220;
    const barX = FIELD.width - 24 - barW;
    context.fillStyle = 'rgba(3, 3, 12, 0.5)';
    roundRect(barX - 150, 8, barW + 174, 104, 10);
    context.fill();
    text('HULL', barX - 10, 22, 16, PALETTE.muted, 'right', 700, 'top');
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(barX, 18, barW, 18);
    const hpColor = p.hp / p.maxHp > 0.35 ? PALETTE.hp : PALETTE.hpLow;
    context.fillStyle = hpColor;
    context.fillRect(barX, 18, barW * Math.max(0, p.hp / p.maxHp), 18);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.lineWidth = 1;
    context.strokeRect(barX, 18, barW, 18);
    // The number straddles the fill edge, so it gets a dark shadow and stays
    // readable on the filled bar and the dark track alike.
    text(`${Math.ceil(p.hp)} / ${p.maxHp}`, barX + barW / 2 + 1, 32, 13, 'rgba(0,0,0,0.65)', 'center', 800);
    text(`${Math.ceil(p.hp)} / ${p.maxHp}`, barX + barW / 2, 31, 13, PALETTE.text, 'center', 800);
    // Dash cooldown under the hull bar: the label first, the bar beneath it.
    const dashReady = p.dashCooldown <= 0;
    text(dashReady ? 'DASH READY [SPACE]' : 'DASH RECHARGING', barX + barW, 44, 14, dashReady ? PALETTE.player : PALETTE.muted, 'right', 700, 'top');
    if (!dashReady) {
      context.fillStyle = 'rgba(255,255,255,0.15)';
      context.fillRect(barX, 62, barW, 5);
      context.fillStyle = PALETTE.player;
      context.fillRect(barX, 62, barW * (1 - p.dashCooldown / 2.2), 5);
    }
    if (p.shield) text('⬢ SHIELD ACTIVE', barX + barW, 72, 14, '#4cc9f0', 'right', 700, 'top');
    if (p.overcharge > 0) text(`OVERCHARGE ${p.overcharge.toFixed(0)}s`, barX + barW, 92, 14, PALETTE.bullet, 'right', 800, 'top');
    // Combo, bottom left.
    if (state.combo >= 3) {
      text(`COMBO x${state.comboMult.toFixed(1)}`, 24, FIELD.height - 58, 26, PALETTE.combo, 'left', 800);
      context.fillStyle = 'rgba(255,255,255,0.15)';
      context.fillRect(24, FIELD.height - 28, 160, 6);
      context.fillStyle = PALETTE.combo;
      context.fillRect(24, FIELD.height - 28, 160 * Math.max(0, state.comboTimer / p.comboWindow), 6);
    }
    // Weapon line, bottom right.
    const w = p.weapons;
    text(`DMG ${Math.round(w.damage)}  ·  SHOTS ${w.shots}  ·  PIERCE ${w.pierce}  ·  CRIT ${Math.round(w.critChance * 100)}%`, FIELD.width - 24, FIELD.height - 24, 14, PALETTE.muted, 'right', 600);
    // First-wave controls hint.
    if (state.wave === 1 && state.elapsed < 9) {
      context.globalAlpha = state.elapsed < 7 ? 1 : Math.max(0, (9 - state.elapsed) / 2);
      text('WASD move  ·  Mouse aim  ·  Hold CLICK to fire  ·  SPACE dash  ·  P pause', FIELD.width / 2, FIELD.height - 24, 16, PALETTE.text, 'center', 600);
      context.globalAlpha = 1;
    }
    // Wave banner: the wave number, and the boss warning on boss waves.
    if (state.bannerTimer > 0) {
      const alpha = Math.min(1, state.bannerTimer);
      context.globalAlpha = alpha;
      text(`WAVE ${state.wave}`, FIELD.width / 2, 148, 46, PALETTE.text, 'center', 800);
      if (state.banner !== '') text(state.banner, FIELD.width / 2, 190, 20, PALETTE.accent, 'center', 800);
      context.globalAlpha = 1;
    }
    // Low-hull warning: a pulsing red frame and a plain warning line.
    if (p.hp > 0 && p.hp / p.maxHp <= 0.3) {
      const pulse = 0.5 + 0.2 * Math.sin(state.time * 6);
      context.strokeStyle = `rgba(255, 77, 109, ${pulse})`;
      context.lineWidth = 4;
      context.strokeRect(6, 6, FIELD.width - 12, FIELD.height - 12);
      context.globalAlpha = 0.6 + 0.4 * Math.sin(state.time * 6);
      text('HULL CRITICAL', FIELD.width / 2, 215, 20, PALETTE.danger, 'center', 800);
      context.globalAlpha = 1;
    }
  }

  function drawPanel(title, lines, prompt, titleColor) {
    const width = 640;
    const lineHeight = 32;
    const height = 150 + lines.length * lineHeight + 74;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    roundRect(x, y, width, height, 16);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    roundRect(x, y, width, height, 16);
    context.stroke();
    text(title, FIELD.width / 2, y + 74, 52, titleColor ?? PALETTE.text, 'center', 800);
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + 128 + i * lineHeight, 21, PALETTE.muted, 'center', 600);
    }
    text(prompt, FIELD.width / 2, y + height - 34, 23, PALETTE.gold, 'center', 700);
  }

  function drawTitle(state, best) {
    drawPanel(
      'NEON VOID',
      [
        'Survive 10 waves. Defeat the Void Core. Win the sector.',
        'Between waves, choose 1 of 3 upgrades for your ship.',
        `6 enemy types · ${UPGRADES.length} upgrades · 2 boss fights`,
        'WASD / Arrows — move      Mouse — aim      Hold CLICK — fire',
        'SPACE — dash through danger      P — pause      M — mute',
        '',
        best > 0 ? bestLabel(best) : 'No flights logged yet — be the first.',
      ],
      'Press SPACE or click to launch',
      '#00f5d4',
    );
  }

  function drawUpgrade(state, mouseX, mouseY) {
    // Dim the field, then three cards.
    context.fillStyle = 'rgba(3, 3, 12, 0.72)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('WAVE CLEARED', FIELD.width / 2, 92, 40, PALETTE.gold, 'center', 800);
    text(`Wave ${state.wave} down  ·  Score ${state.score}  ·  Choose one upgrade`, FIELD.width / 2, 132, 20, PALETTE.text, 'center', 600);
    const cardW = UPGRADE_CARD.w;
    const cardH = UPGRADE_CARD.h;
    const gap = UPGRADE_CARD.gap;
    const totalW = cardW * 3 + gap * 2;
    const startX = (FIELD.width - totalW) / 2;
    const y = UPGRADE_CARD.y;
    for (let i = 0; i < 3; i += 1) {
      const c = state.choices[i];
      if (c === undefined) continue;
      const x = startX + i * (cardW + gap);
      const hover = mouseX >= x && mouseX <= x + cardW && mouseY >= y && mouseY <= y + cardH;
      context.fillStyle = hover ? 'rgba(30, 38, 84, 0.98)' : PALETTE.panel;
      roundRect(x, y, cardW, cardH, 14);
      context.fill();
      context.strokeStyle = hover ? PALETTE.gold : PALETTE.panelEdge;
      context.lineWidth = hover ? 3 : 2;
      roundRect(x, y, cardW, cardH, 14);
      context.stroke();
      text(`[${i + 1}]`, x + cardW / 2, y + 52, 20, PALETTE.muted, 'center', 700);
      text(c.name, x + cardW / 2, y + 108, 24, PALETTE.text, 'center', 800);
      // Word-wrap the description across two lines at most.
      const words = c.desc.split(' ');
      let line = '';
      let lineY = y + 150;
      for (const word of words) {
        if ((line + ' ' + word).trim().length > 26 && line !== '') {
          text(line.trim(), x + cardW / 2, lineY, 18, PALETTE.muted, 'center', 600);
          line = word;
          lineY += 26;
        } else {
          line = `${line} ${word}`;
        }
      }
      if (line.trim() !== '') text(line.trim(), x + cardW / 2, lineY, 18, PALETTE.muted, 'center', 600);
      text('Click or press ' + (i + 1), x + cardW / 2, y + cardH - 30, 16, PALETTE.gold, 'center', 700);
    }
  }

  function drawPaused() {
    context.fillStyle = 'rgba(3, 3, 12, 0.6)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    drawPanel('PAUSED', ['The void waits for you.'], 'Press P to resume', PALETTE.text);
  }

  function drawOver(state, best) {
    const lines = [
      finalLabel(state.score),
      bestLabel(best),
      `Reached wave ${state.wave} of ${FINAL_WAVE}  ·  ${killsLabel(state.kills)}`,
      '',
    ];
    drawPanel('GAME OVER', lines, 'Press SPACE or click to fly again', '#ff4d6d');
  }

  function drawWin(state, best) {
    const minutes = Math.floor(state.elapsed / 60);
    const seconds = Math.floor(state.elapsed % 60).toString().padStart(2, '0');
    const lines = [
      finalLabel(state.score),
      bestLabel(best),
      `${killsLabel(state.kills)}  ·  ${timeLabel(`${minutes}:${seconds}`)}`,
      'The Void Core is dust. The sector is yours.',
      '',
    ];
    drawPanel('VICTORY', lines, 'Press SPACE or click to play again', PALETTE.gold);
  }

  /** Paint one frame: the field, the HUD, and a panel for the screen the game is on. */
  function draw(state, screen, best, ui) {
    const time = state.time;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Screen shake: a deterministic wobble from the clock, scaled by the shake left.
    const sh = state.shake;
    const ox = sh > 0 ? Math.sin(time * 91) * sh * 0.5 : 0;
    const oy = sh > 0 ? Math.cos(time * 113) * sh * 0.5 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + ox * view.scale, view.y + oy * view.scale);
    drawField(state, time);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, best);
      return;
    }
    drawHud(state, best, screen);
    if (screen === SCREEN_UPGRADE) drawUpgrade(state, ui.mouseX, ui.mouseY);
    else if (screen === SCREEN_PAUSED) drawPaused();
    else if (screen === SCREEN_OVER) drawOver(state, best);
    else if (screen === SCREEN_WIN) drawWin(state, best);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
