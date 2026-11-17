// NEON VOID's rules and state, with no drawing and no browser in it: the player
// ship, the waves of enemies and the boss, bullets, pickups, the combo, upgrades
// and the score. step() advances one fixed step and returns what happened as bit
// flags, so the caller can react (sounds, screens) without the world knowing
// about them. Nothing here allocates after createWorld returns: every list is a
// fixed pool and dead entries are reused.

import { COMBO, DROPS, ENEMY, FIELD, FINAL_WAVE, PLAYER, POOL, UPGRADES, waveComposition, waveHpScale, waveSpawnGap } from './config.js';
import { pick, range, rangeInt, shuffle } from './random.js';

export const EVENT_HIT = 1;
export const EVENT_KILL = 2;
export const EVENT_PICKUP = 4;
export const EVENT_WAVE_CLEAR = 8;
export const EVENT_OVER = 16;
export const EVENT_WIN = 32;
export const EVENT_BOSS = 64;
export const EVENT_DASH = 128;
export const EVENT_SHOOT = 256;

const TWO_PI = Math.PI * 2;

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function clampToField(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createWorld(random) {
  const player = {
    x: FIELD.width / 2,
    y: FIELD.height / 2,
    angle: -Math.PI / 2,
    radius: PLAYER.radius,
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    speed: PLAYER.speed,
    magnet: PLAYER.magnet,
    comboWindow: COMBO.window,
    shieldPerWave: 0,
    shield: false,
    /** Nova Dash: a dash blasts nearby enemies. Siphon Rounds: kills heal. */
    shockwave: false,
    lifeSteal: 0,
    invulnerable: 0,
    dashCooldown: 0,
    dashTime: 0,
    dashX: 0,
    dashY: 0,
    fireCooldown: 0,
    overcharge: 0,
    weapons: {
      damage: PLAYER.damage,
      fireInterval: PLAYER.fireInterval,
      bulletSpeed: PLAYER.bulletSpeed,
      bulletRadius: PLAYER.bulletRadius,
      shots: PLAYER.shots,
      pierce: PLAYER.pierce,
      critChance: PLAYER.critChance,
    },
  };

  const bullets = [];
  const ebullets = [];
  const enemies = [];
  const pickups = [];
  const particles = [];
  const floats = [];
  for (let i = 0; i < POOL.bullets; i += 1) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, pierce: 0, radius: 0, life: 0 });
  for (let i = 0; i < POOL.ebullets; i += 1) ebullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, radius: 0, life: 0 });
  for (let i = 0; i < POOL.enemies; i += 1) enemies.push({ active: false, kind: 'chaser', x: 0, y: 0, vx: 0, vy: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, score: 0, contact: 0, t: 0, shootCooldown: 0, state: 0, stateT: 0, angle: 0, orbit: 0 });
  for (let i = 0; i < POOL.pickups; i += 1) pickups.push({ active: false, kind: 'gem', x: 0, y: 0, vx: 0, vy: 0, t: 0 });
  for (let i = 0; i < POOL.particles; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color: '#ffffff' });
  for (let i = 0; i < POOL.floats; i += 1) floats.push({ active: false, x: 0, y: 0, text: '', life: 0, maxLife: 0, color: '#ffffff' });

  const state = {
    player,
    bullets,
    ebullets,
    enemies,
    pickups,
    particles,
    floats,
    wave: 0,
    score: 0,
    combo: 0,
    comboTimer: 0,
    comboMult: 1,
    kills: 0,
    time: 0,
    elapsed: 0,
    shake: 0,
    flash: 0,
    boss: null,
    /** Wave banner: the text and seconds left to show it. */
    banner: '',
    bannerTimer: 0,
    /** 'fighting' while a wave runs, 'clear' once its last enemy dies. */
    waveState: 'fighting',
    spawnQueue: [],
    spawnTimer: 0,
    choices: [],
    stats: { shotsFired: 0, shotsHit: 0 },
  };

  function free(list) {
    for (let i = 0; i < list.length; i += 1) if (!list[i].active) return list[i];
    return null;
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const p = free(particles);
      if (p === null) return;
      const angle = random() * TWO_PI;
      const v = range(random, speed * 0.3, speed);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = range(random, 0.25, 0.6);
      p.life = p.maxLife;
      p.size = range(random, 2, 5);
      p.color = color;
    }
  }

  function addFloat(x, y, text, color) {
    const f = free(floats);
    if (f === null) return;
    f.active = true;
    // Keep floating text out of the HUD band at the top of the field.
    f.x = x;
    f.y = Math.max(84, Math.min(FIELD.height - 12, y));
    f.text = text;
    f.maxLife = 0.8;
    f.life = f.maxLife;
    f.color = color;
  }

  function spawnPoint() {
    // A point on a field edge, at least 260px from the player so nothing appears on top of them.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const edge = rangeInt(random, 0, 3);
      let x = 0;
      let y = 0;
      if (edge === 0) { x = range(random, 40, FIELD.width - 40); y = 30; }
      else if (edge === 1) { x = range(random, 40, FIELD.width - 40); y = FIELD.height - 30; }
      else if (edge === 2) { x = 30; y = range(random, 40, FIELD.height - 40); }
      else { x = FIELD.width - 30; y = range(random, 40, FIELD.height - 40); }
      if (distance(x, y, player.x, player.y) > 260) return { x, y };
    }
    return { x: 40, y: 40 };
  }

  function spawnEnemy(kind, x, y) {
    const e = free(enemies);
    if (e === null) return null;
    const def = ENEMY[kind];
    const scale = waveHpScale(Math.max(1, state.wave));
    e.active = true;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.maxHp = Math.round(def.hp * scale);
    e.hp = e.maxHp;
    e.radius = def.radius;
    e.speed = def.speed * range(random, 0.9, 1.1);
    e.score = def.score;
    e.contact = def.contact;
    e.t = range(random, 0, TWO_PI);
    e.shootCooldown = range(random, 1, 2.5);
    e.state = 0;
    e.stateT = 0;
    e.angle = range(random, 0, TWO_PI);
    e.orbit = range(random, 120, 220);
    return e;
  }

  function spawnPickup(kind, x, y) {
    const p = free(pickups);
    if (p === null) return;
    p.active = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    const angle = random() * TWO_PI;
    p.vx = Math.cos(angle) * 60;
    p.vy = Math.sin(angle) * 60;
    p.t = 0;
  }

  function dropRoll(x, y) {
    const roll = random();
    if (roll < DROPS.health) spawnPickup('health', x, y);
    else if (roll < DROPS.health + DROPS.overcharge) spawnPickup('overcharge', x, y);
    else if (roll < DROPS.health + DROPS.overcharge + DROPS.gem) spawnPickup('gem', x, y);
  }

  function killEnemy(e, events) {
    e.active = false;
    state.kills += 1;
    if (player.lifeSteal > 0) player.hp = Math.min(player.maxHp, player.hp + player.lifeSteal);
    state.combo += 1;
    state.comboTimer = player.comboWindow;
    state.comboMult = Math.min(COMBO.max, 1 + state.combo * COMBO.step);
    const gained = Math.round(e.score * state.comboMult);
    state.score += gained;
    addFloat(e.x, e.y - e.radius, `+${gained}`, '#ffd60a');
    burst(e.x, e.y, ENEMY[e.kind].color, e.kind === 'boss' ? 60 : 18, 260);
    state.shake = Math.min(14, state.shake + (e.kind === 'boss' ? 12 : 4));
    dropRoll(e.x, e.y);
    if (e.kind === 'splitter') {
      for (let i = 0; i < 3; i += 1) {
        const shard = spawnEnemy('shard', e.x + range(random, -16, 16), e.y + range(random, -16, 16));
        if (shard !== null) {
          const angle = random() * TWO_PI;
          shard.vx = Math.cos(angle) * 160;
          shard.vy = Math.sin(angle) * 160;
        }
      }
    }
    if (e.kind === 'boss') {
      state.boss = null;
      state.flash = 0.35;
      return events | EVENT_BOSS;
    }
    return events | EVENT_KILL;
  }

  function damagePlayer(amount, fromX, fromY) {
    if (player.invulnerable > 0 || player.dashTime > 0) return 0;
    if (player.shield) {
      player.shield = false;
      player.invulnerable = 0.6;
      addFloat(player.x, player.y - 28, 'SHIELD', '#4cc9f0');
      return EVENT_HIT;
    }
    player.hp -= amount;
    player.invulnerable = PLAYER.invulnerable;
    state.combo = 0;
    state.comboMult = 1;
    state.comboTimer = 0;
    state.shake = Math.min(16, state.shake + 8);
    state.flash = 0.22;
    burst(player.x, player.y, '#ff4d6d', 14, 220);
    const away = Math.atan2(player.y - fromY, player.x - fromX);
    player.x = clampToField(player.x + Math.cos(away) * 26, 24, FIELD.width - 24);
    player.y = clampToField(player.y + Math.sin(away) * 26, 24, FIELD.height - 24);
    if (player.hp <= 0) {
      player.hp = 0;
      return EVENT_HIT | EVENT_OVER;
    }
    return EVENT_HIT;
  }

  function fireBullet() {
    const w = player.weapons;
    const spread = 0.09;
    const count = w.shots;
    // Muzzle flash: two short-lived sparks at the gun tip.
    burst(player.x + Math.cos(player.angle) * (player.radius + 10), player.y + Math.sin(player.angle) * (player.radius + 10), '#ffe66d', 2, 90);
    for (let i = 0; i < count; i += 1) {
      const b = free(bullets);
      if (b === null) return;
      const offset = (i - (count - 1) / 2) * spread;
      const angle = player.angle + offset;
      b.active = true;
      b.x = player.x + Math.cos(angle) * (player.radius + 8);
      b.y = player.y + Math.sin(angle) * (player.radius + 8);
      b.vx = Math.cos(angle) * w.bulletSpeed;
      b.vy = Math.sin(angle) * w.bulletSpeed;
      b.damage = w.damage;
      b.pierce = w.pierce;
      b.radius = w.bulletRadius;
      b.life = 1.4;
    }
    state.stats.shotsFired += 1;
  }

  function enemyShoot(e, angle, speed, damage) {
    const b = free(ebullets);
    if (b === null) return;
    b.active = true;
    b.x = e.x + Math.cos(angle) * (e.radius + 6);
    b.y = e.y + Math.sin(angle) * (e.radius + 6);
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.damage = damage;
    b.radius = 6;
    b.life = 5;
  }

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2;
    player.angle = -Math.PI / 2;
    player.hp = PLAYER.hp;
    player.maxHp = PLAYER.hp;
    player.speed = PLAYER.speed;
    player.magnet = PLAYER.magnet;
    player.comboWindow = COMBO.window;
    player.shieldPerWave = 0;
    player.shield = false;
    player.shockwave = false;
    player.lifeSteal = 0;
    player.invulnerable = 0;
    player.dashCooldown = 0;
    player.dashTime = 0;
    player.fireCooldown = 0;
    player.overcharge = 0;
    player.weapons.damage = PLAYER.damage;
    player.weapons.fireInterval = PLAYER.fireInterval;
    player.weapons.bulletSpeed = PLAYER.bulletSpeed;
    player.weapons.bulletRadius = PLAYER.bulletRadius;
    player.weapons.shots = PLAYER.shots;
    player.weapons.pierce = PLAYER.pierce;
    player.weapons.critChance = PLAYER.critChance;
    for (const list of [bullets, ebullets, enemies, pickups, particles, floats]) {
      for (const item of list) item.active = false;
    }
    state.wave = 0;
    state.score = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.comboMult = 1;
    state.kills = 0;
    state.time = 0;
    state.elapsed = 0;
    state.shake = 0;
    state.flash = 0;
    state.boss = null;
    state.banner = '';
    state.bannerTimer = 0;
    state.waveState = 'fighting';
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.choices = [];
    state.stats.shotsFired = 0;
    state.stats.shotsHit = 0;
  }

  /** Begin a wave: fill its spawn queue and, on boss waves, add the Void Core. */
  function startWave(wave) {
    state.wave = wave;
    state.waveState = 'fighting';
    state.spawnQueue = shuffle(random, waveComposition(wave));
    state.spawnTimer = 0.8;
    state.banner = wave === 5 ? 'VOID CORE AWAKENS' : wave === FINAL_WAVE ? 'VOID CORE — FINAL FORM' : '';
    state.bannerTimer = 2.4;
    player.shield = player.shieldPerWave > 0;
    if (wave === 5 || wave === FINAL_WAVE) {
      const at = spawnPoint();
      const boss = spawnEnemy('boss', at.x, at.y);
      if (boss !== null) {
        boss.maxHp = Math.round(boss.maxHp * (wave === FINAL_WAVE ? 1.6 : 1));
        boss.hp = boss.maxHp;
        state.boss = boss;
      }
    }
  }

  /** Roll three different upgrade cards for the between-wave choice. */
  function rollChoices() {
    const pool = UPGRADES.slice();
    shuffle(random, pool);
    state.choices = pool.slice(0, 3);
    return state.choices;
  }

  /** Apply one of the rolled choices by id, then clear the offer. */
  function applyUpgrade(id) {
    const choice = state.choices.find((c) => c.id === id);
    if (choice === undefined) return false;
    choice.apply(player);
    state.choices = [];
    return true;
  }

  function moveEnemy(e, dt) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    if (e.kind === 'chaser' || e.kind === 'shard' || e.kind === 'tank') {
      e.vx = nx * e.speed;
      e.vy = ny * e.speed;
    } else if (e.kind === 'shooter') {
      // Keep a firing distance: close in when far, back off when too near.
      const want = dist > 300 ? 1 : dist < 200 ? -1 : 0;
      e.vx = nx * e.speed * want;
      e.vy = ny * e.speed * want;
      e.shootCooldown -= dt;
      if (e.shootCooldown <= 0 && dist < 520) {
        e.shootCooldown = 2.1;
        enemyShoot(e, Math.atan2(dy, dx), 260, 8);
      }
    } else if (e.kind === 'dasher') {
      e.stateT -= dt;
      if (e.state === 0) {
        e.vx = nx * e.speed;
        e.vy = ny * e.speed;
        if (dist < 280) {
          e.state = 1;
          e.stateT = 0.6;
          e.angle = Math.atan2(dy, dx);
        }
      } else if (e.state === 1) {
        // Telegraph: shake in place, then lunge.
        e.vx = Math.cos(e.t * 40) * 12;
        e.vy = Math.sin(e.t * 40) * 12;
        if (e.stateT <= 0) {
          e.state = 2;
          e.stateT = 0.42;
          e.vx = Math.cos(e.angle) * 540;
          e.vy = Math.sin(e.angle) * 540;
        }
      } else {
        if (e.stateT <= 0) {
          e.state = 0;
          e.stateT = 1.2;
          e.vx = 0;
          e.vy = 0;
        }
      }
    } else if (e.kind === 'orbiter') {
      e.t += dt * 1.6;
      const targetRadius = Math.max(90, e.orbit - state.elapsed * 2);
      const wantX = player.x + Math.cos(e.t) * targetRadius;
      const wantY = player.y + Math.sin(e.t) * targetRadius;
      e.vx = (wantX - e.x) * 2.2;
      e.vy = (wantY - e.y) * 2.2;
    } else if (e.kind === 'boss') {
      e.vx = nx * e.speed;
      e.vy = ny * e.speed;
      e.shootCooldown -= dt;
      if (e.shootCooldown <= 0) {
        e.shootCooldown = 2.4;
        e.state += 1;
        // The final form alternates its radial burst with a rotating spiral.
        if (state.wave === FINAL_WAVE && e.state % 2 === 0) {
          for (let i = 0; i < 16; i += 1) enemyShoot(e, (i / 16) * TWO_PI + e.t + e.state * 0.35, 210, 10);
        } else {
          // Radial burst.
          for (let i = 0; i < 12; i += 1) enemyShoot(e, (i / 12) * TWO_PI + e.t, 200, 10);
          // Aimed three-shot spread.
          const aim = Math.atan2(dy, dx);
          for (let i = -1; i <= 1; i += 1) enemyShoot(e, aim + i * 0.14, 300, 10);
        }
      }
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.stateT = 6;
        for (let i = 0; i < 3; i += 1) {
          const at = spawnPoint();
          spawnEnemy(state.wave === FINAL_WAVE ? 'orbiter' : 'chaser', at.x, at.y);
        }
      }
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.x = clampToField(e.x, e.radius, FIELD.width - e.radius);
    e.y = clampToField(e.y, e.radius, FIELD.height - e.radius);
    e.t += dt;
  }

  /**
   * One fixed step. `input` is { moveX, moveY, aimX, aimY, firing, dash }.
   * With `harmless` set (the title screen's backdrop) things drift but nothing
   * hurts the player and nothing scores.
   */
  function step(dt, input, harmless) {
    let events = 0;
    state.time += dt;
    if (!harmless) state.elapsed += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
    if (state.bannerTimer > 0) state.bannerTimer = Math.max(0, state.bannerTimer - dt);
    if (player.invulnerable > 0) player.invulnerable -= dt;
    if (player.dashCooldown > 0) player.dashCooldown -= dt;
    if (player.overcharge > 0) player.overcharge -= dt;
    if (player.fireCooldown > 0) player.fireCooldown -= dt;
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) {
        state.combo = 0;
        state.comboMult = 1;
      }
    }

    // --- player movement and dash ---
    player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);
    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const speed = PLAYER.dashDistance / PLAYER.dashTime;
      player.x += player.dashX * speed * dt;
      player.y += player.dashY * speed * dt;
      if (random() < 0.6) {
        const p = free(particles);
        if (p !== null) {
          p.active = true;
          p.x = player.x;
          p.y = player.y;
          p.vx = range(random, -30, 30);
          p.vy = range(random, -30, 30);
          p.maxLife = 0.3;
          p.life = 0.3;
          p.size = 4;
          p.color = '#00f5d4';
        }
      }
    } else {
      player.x += input.moveX * player.speed * dt;
      player.y += input.moveY * player.speed * dt;
      if (input.dash && player.dashCooldown <= 0 && (input.moveX !== 0 || input.moveY !== 0)) {
        const length = Math.hypot(input.moveX, input.moveY) || 1;
        player.dashX = input.moveX / length;
        player.dashY = input.moveY / length;
        player.dashTime = PLAYER.dashTime;
        player.dashCooldown = PLAYER.dashCooldown;
        events |= EVENT_DASH;
        // Nova Dash: the dash itself is a weapon.
        if (player.shockwave) {
          for (let i = 0; i < enemies.length; i += 1) {
            const e = enemies[i];
            if (!e.active) continue;
            if (distance(e.x, e.y, player.x, player.y) < 170) {
              e.hp -= 25;
              burst(e.x, e.y, '#00f5d4', 6, 180);
              if (e.hp <= 0) events |= killEnemy(e, 0);
            }
          }
        }
      }
    }
    player.x = clampToField(player.x, player.radius, FIELD.width - player.radius);
    player.y = clampToField(player.y, player.radius, FIELD.height - player.radius);

    // --- firing ---
    if (input.firing && player.fireCooldown <= 0 && !harmless) {
      const interval = player.overcharge > 0 ? player.weapons.fireInterval * 0.5 : player.weapons.fireInterval;
      fireBullet();
      events |= EVENT_SHOOT;
      player.fireCooldown = interval;
    }

    // --- spawning (also in harmless mode, so the title's backdrop has life) ---
    if (state.waveState === 'fighting' && state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        state.spawnTimer = waveSpawnGap(state.wave);
        const kind = state.spawnQueue.pop();
        const at = spawnPoint();
        spawnEnemy(kind, at.x, at.y);
      }
    }

    // --- enemies ---
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!e.active) continue;
      moveEnemy(e, dt);
      if (harmless) continue;
      if (distance(e.x, e.y, player.x, player.y) < e.radius + player.radius - 2) {
        const result = damagePlayer(e.contact, e.x, e.y);
        events |= result;
        if (result & EVENT_OVER) return events;
      }
    }

    // --- player bullets ---
    for (let i = 0; i < bullets.length; i += 1) {
      const b = bullets[i];
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        b.active = false;
        continue;
      }
      for (let j = 0; j < enemies.length; j += 1) {
        const e = enemies[j];
        if (!e.active) continue;
        if (distance(b.x, b.y, e.x, e.y) < b.radius + e.radius) {
          const crit = random() < player.weapons.critChance;
          const damage = Math.round(b.damage * (crit ? PLAYER.critDamage : 1));
          e.hp -= damage;
          state.stats.shotsHit += 1;
          // Only critical hits print a number: every hit would drown the field in text.
          if (crit) addFloat(e.x + range(random, -8, 8), e.y - e.radius - 4, String(damage), '#ff9f1c');
          burst(b.x, b.y, '#ffe66d', 3, 140);
          if (e.hp <= 0) events |= killEnemy(e, 0);
          if (b.pierce > 0) {
            b.pierce -= 1;
          } else {
            b.active = false;
          }
          break;
        }
      }
    }

    // --- enemy bullets ---
    for (let i = 0; i < ebullets.length; i += 1) {
      const b = ebullets[i];
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        b.active = false;
        continue;
      }
      if (!harmless && distance(b.x, b.y, player.x, player.y) < b.radius + player.radius - 2) {
        b.active = false;
        const result = damagePlayer(b.damage, b.x - b.vx, b.y - b.vy);
        events |= result;
        if (result & EVENT_OVER) return events;
      }
    }

    // --- pickups ---
    for (let i = 0; i < pickups.length; i += 1) {
      const p = pickups[i];
      if (!p.active) continue;
      p.t += dt;
      const d = distance(p.x, p.y, player.x, player.y);
      if (d < player.magnet) {
        const pull = 420 * (1 - d / player.magnet) + 120;
        p.vx += ((player.x - p.x) / (d || 1)) * pull * dt * 4;
        p.vy += ((player.y - p.y) / (d || 1)) * pull * dt * 4;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (p.t > 12) {
        p.active = false;
        continue;
      }
      if (d < player.radius + 14) {
        p.active = false;
        events |= EVENT_PICKUP;
        if (p.kind === 'health') {
          player.hp = Math.min(player.maxHp, player.hp + 25);
          addFloat(player.x, player.y - 28, '+25 HP', '#80ed99');
        } else if (p.kind === 'overcharge') {
          player.overcharge = 8;
          addFloat(player.x, player.y - 28, 'OVERCHARGE', '#ffe66d');
        } else {
          const gained = Math.round(100 * state.comboMult);
          state.score += gained;
          addFloat(p.x, p.y - 10, `+${gained}`, '#ffd60a');
        }
      }
    }

    // --- particles and floating text ---
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    for (let i = 0; i < floats.length; i += 1) {
      const f = floats[i];
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        continue;
      }
      f.y -= 34 * dt;
    }

    // --- wave clear ---
    if (!harmless && state.waveState === 'fighting' && state.spawnQueue.length === 0) {
      let alive = false;
      for (let i = 0; i < enemies.length; i += 1) {
        if (enemies[i].active) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        state.waveState = 'clear';
        state.score += 250 * state.wave;
        if (state.wave >= FINAL_WAVE) return events | EVENT_WIN;
        return events | EVENT_WAVE_CLEAR;
      }
    }
    return events;
  }

  reset();
  return { state, reset, step, startWave, rollChoices, applyUpgrade };
}
