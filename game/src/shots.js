// The screenshot scenes behind ?shot=start|play|upgrade|end|victory. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by
// a simple autopilot, so the frame is what a short game really looks like and
// the same seed always gives the same frame. The play pilot kites and shoots
// well; the end pilot stands its ground and never dashes, so it is caught out
// as a hurried player is; the victory pilot is the skilled one playing all
// ten waves through, so the frame is the real win screen.

import { FIELD, STEP } from './config.js';
import { EVENT_OVER, EVENT_WAVE_CLEAR, EVENT_WIN } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_UPGRADE, SCREEN_WIN } from './render.js';

const START_SECONDS = 8;
const PLAY_TARGET_WAVE = 5;
const GATHER_SECONDS = 3;
const FIGHT_SECONDS = 1.0;
const LIMIT_SECONDS = 150;
const VICTORY_LIMIT_SECONDS = 420;
const SAMPLE_BEST = 2480;

/** The nearest living enemy to the player, or null when the field is empty. */
function nearestEnemy(state) {
  let best = null;
  let bestDist = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = Math.hypot(e.x - state.player.x, e.y - state.player.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return { enemy: best, dist: bestDist };
}

/**
 * One autopilot step: kite the nearest enemy (back off when it closes in,
 * close in when it is far), aim at it, fire whenever anything lives.
 * `skilled` also dashes out when something gets too close. `patient` fires
 * only at close range, so a wave can build up around the ship instead of
 * being thinned out as it spawns.
 */
function autopilot(state, skilled, patient) {
  const { enemy, dist } = nearestEnemy(state);
  const p = state.player;
  if (enemy === null) {
    return { moveX: 0, moveY: 0, aimX: p.x, aimY: p.y - 100, firing: false, dash: false };
  }
  let mx = 0;
  let my = 0;
  if (skilled) {
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const len = Math.hypot(dx, dy) || 1;
    if (dist < 170) {
      mx = dx / len;
      my = dy / len;
    } else if (dist > 300) {
      mx = -dx / len;
      my = -dy / len;
    } else {
      // Strafe sideways at mid range so the frame is not a head-on line.
      mx = -dy / len;
      my = dx / len;
    }
    // Stay off the walls.
    if (p.x < 120) mx += 0.7;
    if (p.x > FIELD.width - 120) mx -= 0.7;
    if (p.y < 120) my += 0.7;
    if (p.y > FIELD.height - 120) my -= 0.7;
    const mLen = Math.hypot(mx, my) || 1;
    mx /= mLen;
    my /= mLen;
  }
  return {
    moveX: mx,
    moveY: my,
    aimX: enemy.x,
    aimY: enemy.y,
    firing: patient === true ? dist < 170 : true,
    dash: skilled && dist < 110 && p.dashCooldown <= 0,
  };
}

/**
 * The gather: drift toward the middle of the swarm, weapon cold, and let it
 * close in — so the play frame catches the fight at its thickest, with the
 * ship in the middle of the action instead of off in a corner.
 */
function gatherInput(state) {
  const p = state.player;
  const { enemy } = nearestEnemy(state);
  let cx = FIELD.width / 2;
  let cy = FIELD.height / 2;
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (const e of state.enemies) {
    if (!e.active) continue;
    sx += e.x;
    sy += e.y;
    count += 1;
  }
  if (count > 0) {
    cx = sx / count;
    cy = sy / count;
  }
  const dx = cx - p.x;
  const dy = cy - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    moveX: (dx / len) * 0.7,
    moveY: (dy / len) * 0.7,
    aimX: enemy === null ? p.x : enemy.x,
    aimY: enemy === null ? p.y - 100 : enemy.y,
    firing: false,
    dash: false,
  };
}

function idleInput(state) {
  const p = state.player;
  return { moveX: 0, moveY: 0, aimX: p.x, aimY: p.y - 120, firing: false, dash: false };
}

/**
 * Set `world` to the named scene (start, play, upgrade, end or victory; any
 * other name is start) and return the screen to draw over it and the best
 * score to show.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'play') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      world.reset();
      world.startWave(1);
      // Clear waves up to the target, taking an upgrade after each one as a
      // player would. In the target wave, fight the Void Core until it is
      // half broken, then gather: drift to the centre and let the swarm close
      // in. Then fight for a moment, and take the frame at the thickest of
      // it — boss, bullets and swarm all in view.
      let phase = 0;
      let phaseTime = 0;
      let died = false;
      let staged = false;
      for (let i = 0; i < LIMIT_SECONDS / STEP; i += 1) {
        let input;
        if (phase === 1) input = gatherInput(state);
        else input = autopilot(state, true, false);
        const events = world.step(STEP, input, false);
        if (events & EVENT_OVER) {
          died = true;
          break;
        }
        if (phase === 0) {
          if (events & EVENT_WAVE_CLEAR) {
            world.rollChoices();
            const choice = state.choices[0];
            if (choice !== undefined) world.applyUpgrade(choice.id);
            world.startWave(state.wave + 1);
          } else if (
            state.wave >= PLAY_TARGET_WAVE
            && state.boss !== null
            && state.boss.active
            && state.boss.hp < state.boss.maxHp * 0.55
          ) {
            phase = 1;
            phaseTime = 0;
          }
        } else if (phase === 1) {
          phaseTime += STEP;
          if (phaseTime >= GATHER_SECONDS) {
            phase = 2;
            phaseTime = 0;
          }
        } else {
          phaseTime += STEP;
          if (phaseTime >= FIGHT_SECONDS) {
            staged = true;
            break;
          }
        }
      }
      if (!died && staged) {
        return { screen: SCREEN_PLAY, best: Math.max(SAMPLE_BEST, state.score) };
      }
    }
    // Every attempt died early (it should not): hand back the last frame anyway.
    return { screen: SCREEN_PLAY, best: Math.max(SAMPLE_BEST, state.score) };
  }
  if (name === 'upgrade') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      world.reset();
      world.startWave(1);
      let cleared = false;
      for (let i = 0; i < LIMIT_SECONDS / STEP; i += 1) {
        const events = world.step(STEP, autopilot(state, true), false);
        if (events & EVENT_OVER) break;
        if (events & EVENT_WAVE_CLEAR) {
          cleared = true;
          break;
        }
      }
      if (cleared) {
        world.rollChoices();
        return { screen: SCREEN_UPGRADE, best: Math.max(SAMPLE_BEST, state.score) };
      }
    }
    // The pilot never cleared wave 1 (it should): fall back to a play frame.
    return { screen: SCREEN_PLAY, best: SAMPLE_BEST };
  }
  if (name === 'end') {
    world.reset();
    world.startWave(1);
    for (let i = 0; i < LIMIT_SECONDS / STEP; i += 1) {
      const events = world.step(STEP, autopilot(state, false), false);
      if (events & EVENT_OVER) break;
      if (events & EVENT_WAVE_CLEAR) world.startWave(state.wave + 1);
    }
    return { screen: SCREEN_OVER, best: Math.max(SAMPLE_BEST, state.score) };
  }
  if (name === 'victory') {
    // The skilled pilot plays the whole campaign through, taking an upgrade
    // after each wave as a player would, until wave 10 is cleared and the
    // world reports the win. The frame is then the real victory screen:
    // VICTORY panel with the final score, best, kills and time, over a HUD
    // reading WAVE 10 / 10 and SECTOR CLEAR.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      world.reset();
      world.startWave(1);
      let won = false;
      for (let i = 0; i < VICTORY_LIMIT_SECONDS / STEP; i += 1) {
        const events = world.step(STEP, autopilot(state, true), false);
        if (events & EVENT_OVER) break;
        if (events & EVENT_WIN) {
          won = true;
          break;
        }
        if (events & EVENT_WAVE_CLEAR) {
          world.rollChoices();
          const choice = state.choices[0];
          if (choice !== undefined) world.applyUpgrade(choice.id);
          world.startWave(state.wave + 1);
        }
      }
      if (won) {
        return { screen: SCREEN_WIN, best: Math.max(SAMPLE_BEST, state.score) };
      }
    }
    // The pilot never won (it should): hand back the last frame as a play
    // frame rather than a victory the game did not earn.
    return { screen: SCREEN_PLAY, best: Math.max(SAMPLE_BEST, state.score) };
  }
  // start: the title over a live backdrop. Wave 3, not wave 1, so shooters
  // and splitters are already on the field and the backdrop has colour.
  world.reset();
  world.startWave(3);
  for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, idleInput(state), true);
  return { screen: SCREEN_TITLE, best: SAMPLE_BEST };
}
