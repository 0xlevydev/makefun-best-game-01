// Synthesized sound effects with the Web Audio API: no audio files, nothing to
// download, everything generated from oscillators and noise. Created lazily on the
// first user gesture (browsers block audio before one) and silent until then.

const MASTER_GAIN = 0.22;

export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context !== null) return true;
    try {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (AudioContext === undefined) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  /** Unlock audio from a user gesture; call from any key or pointer handler. */
  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function tone(freq, duration, type, volume, slideTo) {
    if (!ensure() || muted || context.state !== 'running') return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function noise(duration, volume, lowpass) {
    if (!ensure() || muted || context.state !== 'running') return;
    const now = context.currentTime;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
    shoot() {
      tone(880, 0.07, 'square', 0.05, 320);
    },
    hit() {
      tone(220, 0.08, 'sawtooth', 0.08, 90);
    },
    explosion() {
      noise(0.28, 0.22, 900);
      tone(160, 0.25, 'sine', 0.16, 40);
    },
    hurt() {
      tone(140, 0.22, 'sawtooth', 0.14, 55);
      noise(0.12, 0.1, 500);
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.09, 990);
    },
    dash() {
      noise(0.14, 0.1, 2400);
    },
    waveClear() {
      tone(523, 0.12, 'triangle', 0.1);
      setTimeout(() => tone(659, 0.12, 'triangle', 0.1), 110);
      setTimeout(() => tone(784, 0.2, 'triangle', 0.12), 220);
    },
    upgrade() {
      tone(392, 0.1, 'triangle', 0.1, 784);
    },
    boss() {
      tone(98, 0.5, 'sawtooth', 0.16, 49);
      noise(0.4, 0.1, 300);
    },
    gameOver() {
      tone(392, 0.25, 'triangle', 0.12, 370);
      setTimeout(() => tone(311, 0.25, 'triangle', 0.12, 294), 240);
      setTimeout(() => tone(233, 0.5, 'triangle', 0.12, 220), 480);
    },
    victory() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => setTimeout(() => tone(freq, 0.22, 'triangle', 0.12), i * 130));
    },
  };
}
