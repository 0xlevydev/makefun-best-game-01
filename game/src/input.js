// Keyboard and mouse input, read once a frame. Movement keys give a direction
// vector; the mouse gives an aim point in field coordinates and a firing state;
// single-press actions (dash, pause, confirm, upgrade choices, mute) are queued
// as bits and taken once, so a held key never double-fires.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_DASH = 4;
export const ACTION_MUTE = 8;
export const ACTION_CHOICE_1 = 16;
export const ACTION_CHOICE_2 = 32;
export const ACTION_CHOICE_3 = 64;

const KEY_ACTIONS = {
  Space: ACTION_CONFIRM,
  Enter: ACTION_CONFIRM,
  KeyP: ACTION_PAUSE,
  Escape: ACTION_PAUSE,
  ShiftLeft: ACTION_DASH,
  ShiftRight: ACTION_DASH,
  KeyM: ACTION_MUTE,
  Digit1: ACTION_CHOICE_1,
  Digit2: ACTION_CHOICE_2,
  Digit3: ACTION_CHOICE_3,
  Numpad1: ACTION_CHOICE_1,
  Numpad2: ACTION_CHOICE_2,
  Numpad3: ACTION_CHOICE_3,
};

const MOVE_KEYS = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function createInput(canvas, fieldWidth, fieldHeight) {
  const keys = new Set();
  let queued = 0;
  let mouseX = fieldWidth / 2;
  let mouseY = fieldHeight / 2 - 100;
  let mouseDown = false;
  let mouseClicked = false;

  function toField(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / fieldWidth, rect.height / fieldHeight);
    const offsetX = (rect.width - fieldWidth * scale) / 2;
    const offsetY = (rect.height - fieldHeight * scale) / 2;
    mouseX = (event.clientX - rect.left - offsetX) / scale;
    mouseY = (event.clientY - rect.top - offsetY) / scale;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    const action = KEY_ACTIONS[event.code];
    if (action !== undefined) queued |= action;
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    mouseDown = false;
  });
  canvas.addEventListener('mousemove', toField);
  canvas.addEventListener('mousedown', (event) => {
    toField(event);
    mouseDown = true;
    mouseClicked = true;
    queued |= ACTION_CONFIRM;
  });
  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  /** The movement direction this frame, normalised, from the keys held down. */
  function direction() {
    let x = 0;
    let y = 0;
    for (const code of keys) {
      const move = MOVE_KEYS[code];
      if (move !== undefined) {
        x += move[0];
        y += move[1];
      }
    }
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const length = Math.hypot(x, y);
    return { x: x / length, y: y / length };
  }

  /** The single-press actions queued since the last call, then cleared. */
  function takeActions() {
    const actions = queued;
    queued = 0;
    return actions;
  }

  /** Whether the mouse was clicked since the last call (for card buttons). */
  function takeClick() {
    const clicked = mouseClicked;
    mouseClicked = false;
    return clicked;
  }

  return {
    direction,
    takeActions,
    takeClick,
    get mouseX() {
      return mouseX;
    },
    get mouseY() {
      return mouseY;
    },
    get firing() {
      return mouseDown;
    },
  };
}
