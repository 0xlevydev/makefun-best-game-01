// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between six screens: title, play,
// upgrade choice, paused, victory and game over.
//
// ?seed=N fixes the run's randomness. ?shot=start|play|upgrade|end (with
// &seed=N) stages that scene instead of running the loop, paints it twice and
// sets window.__shotReady for a screenshot.

import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createAudio } from './audio.js';
import { createWorld, EVENT_BOSS, EVENT_DASH, EVENT_HIT, EVENT_KILL, EVENT_OVER, EVENT_PICKUP, EVENT_SHOOT, EVENT_WAVE_CLEAR, EVENT_WIN } from './world.js';
import { ACTION_CHOICE_1, ACTION_CHOICE_2, ACTION_CHOICE_3, ACTION_CONFIRM, ACTION_DASH, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_UPGRADE, SCREEN_WIN, choiceAt } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, { mouseX: -1, mouseY: -1 });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, 1280, 720);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  /** A dash pressed since the last frame, handed to the next fixed step. */
  let dashQueued = false;

  // The title's backdrop: wave 1 drifts behind the panel, harmless.
  world.startWave(1);

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    world.startWave(1);
    accumulator = 0;
    screen = SCREEN_PLAY;
    // The click that launched the game must not leak into a later upgrade choice.
    input.takeClick();
    announce('Playing. Survive 10 waves.');
  }

  function endGame(won) {
    screen = won ? SCREEN_WIN : SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    if (won) {
      audio.victory();
      announce(`Victory. Score ${world.state.score}. Best ${best}.`);
    } else {
      audio.gameOver();
      announce(`Game over. Score ${world.state.score}. Best ${best}.`);
    }
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_WIN) {
      if (actions & ACTION_CONFIRM) {
        audio.unlock();
        startGame();
      }
      return;
    }
    if (screen === SCREEN_PLAY) {
      if (actions & ACTION_DASH) dashQueued = true;
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (screen === SCREEN_UPGRADE) {
      let choice = -1;
      if (actions & ACTION_CHOICE_1) choice = 0;
      else if (actions & ACTION_CHOICE_2) choice = 1;
      else if (actions & ACTION_CHOICE_3) choice = 2;
      else if (input.takeClick()) choice = choiceAt(input.mouseX, input.mouseY);
      if (choice >= 0) {
        const picked = world.state.choices[choice];
        if (picked !== undefined && world.applyUpgrade(picked.id)) {
          audio.upgrade();
          world.startWave(world.state.wave + 1);
          screen = SCREEN_PLAY;
          announce(`Wave ${world.state.wave}. ${picked.name}.`);
        }
      }
    }
  }

  function playEvents(events) {
    if (events & EVENT_SHOOT) audio.shoot();
    if (events & EVENT_HIT) audio.hurt();
    if (events & EVENT_KILL) audio.hit();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_DASH) audio.dash();
    if (events & EVENT_BOSS) audio.boss();
    if (events & EVENT_WAVE_CLEAR) {
      audio.waveClear();
      world.rollChoices();
      // A click from before the cards appeared is not a choice: drain it, so
      // only a click made on this screen can pick a card.
      input.takeClick();
      screen = SCREEN_UPGRADE;
      announce(`Wave ${world.state.wave} cleared. Choose an upgrade.`);
    }
    if (events & EVENT_WIN) endGame(true);
    else if (events & EVENT_OVER) endGame(false);
  }

  function step(dash) {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { moveX: 0, moveY: 0, aimX: 640, aimY: 300, firing: false, dash: false }, true);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const move = input.direction();
    const events = world.step(
      STEP,
      {
        moveX: move.x,
        moveY: move.y,
        aimX: input.mouseX,
        aimY: input.mouseY,
        firing: input.firing,
        dash,
      },
      false,
    );
    playEvents(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    const dash = dashQueued;
    dashQueued = false;
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(dash);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, { mouseX: input.mouseX, mouseY: input.mouseY });
  }

  // Leaving the tab pauses a running game rather than letting enemies close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  announce('Neon Void. Press Space or click to launch.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
