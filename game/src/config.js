// NEON VOID — every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How many waves the campaign lasts; clearing wave 10 wins the game. */
export const FINAL_WAVE = 10;

export const PLAYER = {
  radius: 18,
  speed: 300,
  hp: 100,
  /** Seconds of invulnerability after taking a hit. */
  invulnerable: 1.0,
  /** Dash: distance in pixels, cooldown and invulnerability while dashing. */
  dashDistance: 170,
  dashCooldown: 2.2,
  dashTime: 0.16,
  /** Base weapon. */
  damage: 12,
  fireInterval: 0.16,
  bulletSpeed: 640,
  bulletRadius: 6,
  shots: 1,
  pierce: 0,
  critChance: 0.05,
  critDamage: 2,
  magnet: 90,
};

/** Combo: each kill raises the multiplier; it decays after this many seconds without a kill. */
export const COMBO = { window: 2.5, step: 0.1, max: 5 };

/** Enemy kinds, by key. Every kind has a shape, a colour and a behaviour in world.js. */
export const ENEMY = {
  chaser:   { radius: 18, hp: 20,  speed: 110, score: 50,  contact: 10, color: '#ff4d6d' },
  shooter:  { radius: 17, hp: 26,  speed: 80,  score: 80,  contact: 8,  color: '#ff9f1c' },
  splitter: { radius: 22, hp: 34,  speed: 70,  score: 90,  contact: 10, color: '#80ed99' },
  shard:    { radius: 10, hp: 8,   speed: 190, score: 20,  contact: 6,  color: '#b7f5c3' },
  dasher:   { radius: 17, hp: 30,  speed: 90,  score: 110, contact: 14, color: '#4cc9f0' },
  orbiter:  { radius: 16, hp: 24,  speed: 150, score: 100, contact: 8,  color: '#c77dff' },
  tank:     { radius: 28, hp: 110, speed: 48,  score: 150, contact: 18, color: '#ef476f' },
  boss:     { radius: 56, hp: 900, speed: 55,  score: 2000, contact: 25, color: '#ff2e63' },
};

/** What a wave is made of: how many of each kind join, before the boss waves. */
export function waveComposition(wave) {
  const list = [];
  const add = (kind, count) => { for (let i = 0; i < count; i += 1) list.push(kind); };
  add('chaser', 5 + wave * 2);
  if (wave >= 2) add('shooter', 1 + wave);
  if (wave >= 3) add('splitter', 1 + Math.floor(wave / 2));
  if (wave >= 4) add('dasher', Math.floor(wave / 2));
  if (wave >= 5) add('orbiter', Math.floor(wave / 2));
  if (wave >= 6) add('tank', Math.floor((wave - 4) / 2));
  return list;
}

/** A wave's spawn gap in seconds; waves get denser as they go. */
export function waveSpawnGap(wave) {
  return Math.max(0.3, 0.95 - wave * 0.06);
}

/** Enemy health scales a little with the wave, so later waves stay dangerous. */
export function waveHpScale(wave) {
  return 1 + (wave - 1) * 0.12;
}

/** The upgrade cards offered between waves. Each has an id, a name, a short line and an apply(). */
export const UPGRADES = [
  { id: 'damage', name: 'Overcharged Rounds', desc: '+30% bullet damage', apply: (p) => { p.weapons.damage *= 1.3; } },
  { id: 'firerate', name: 'Rapid Trigger', desc: '+22% fire rate', apply: (p) => { p.weapons.fireInterval *= 0.82; } },
  { id: 'multishot', name: 'Split Cannon', desc: '+1 projectile per shot', apply: (p) => { p.weapons.shots += 1; } },
  { id: 'pierce', name: 'Lance Rounds', desc: 'Bullets pierce +1 enemy', apply: (p) => { p.weapons.pierce += 1; } },
  { id: 'crit', name: 'Deadeye Core', desc: '+12% critical chance', apply: (p) => { p.weapons.critChance += 0.12; } },
  { id: 'speed', name: 'Ion Thrusters', desc: '+14% move speed', apply: (p) => { p.speed *= 1.14; } },
  { id: 'hull', name: 'Reinforced Hull', desc: '+30 max HP and repair 30', apply: (p) => { p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); } },
  { id: 'dash', name: 'Blink Drive', desc: 'Dash recharges 35% faster', apply: (p) => { p.dashCooldown *= 0.65; } },
  { id: 'magnet', name: 'Tractor Field', desc: 'Pickups fly to you from farther away', apply: (p) => { p.magnet *= 1.8; } },
  { id: 'combo', name: 'Frenzy Link', desc: 'Combo lasts 1.5s longer', apply: (p) => { p.comboWindow += 1.5; } },
  { id: 'shield', name: 'Aegis Plating', desc: 'Start each wave with a shield that blocks one hit', apply: (p) => { p.shieldPerWave = 1; } },
  { id: 'velocity', name: 'Railgun Coils', desc: '+25% bullet speed and size', apply: (p) => { p.weapons.bulletSpeed *= 1.25; p.weapons.bulletRadius += 1; } },
  { id: 'nova', name: 'Nova Dash', desc: 'Dashing blasts nearby enemies for 25 damage', apply: (p) => { p.shockwave = true; } },
  { id: 'vampire', name: 'Siphon Rounds', desc: 'Each kill restores 2 HP', apply: (p) => { p.lifeSteal = (p.lifeSteal ?? 0) + 2; } },
];

/** Drop chances for pickups when an enemy dies. */
export const DROPS = { health: 0.09, overcharge: 0.05, gem: 0.35 };

export const PALETTE = {
  backdrop: '#050510',
  field: '#0a0a1e',
  grid: 'rgba(90, 120, 255, 0.09)',
  nebula1: 'rgba(120, 40, 200, 0.20)',
  nebula2: 'rgba(20, 120, 200, 0.15)',
  player: '#00f5d4',
  playerCore: '#e0fff9',
  bullet: '#ffe66d',
  bulletCore: '#fffbe6',
  text: '#f1f5ff',
  muted: '#8b93b8',
  panel: 'rgba(10, 12, 34, 0.92)',
  panelEdge: '#3d5afe',
  accent: '#ff2e63',
  gold: '#ffd60a',
  danger: '#ff4d6d',
  hp: '#00f5d4',
  hpLow: '#ff4d6d',
  combo: '#ff9f1c',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'neon-void.best';

/** How many of each pool the world pre-allocates; nothing allocates mid-frame after boot. */
export const POOL = { bullets: 256, ebullets: 256, enemies: 96, pickups: 64, particles: 512, floats: 48 };
