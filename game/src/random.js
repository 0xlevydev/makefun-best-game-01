// A small seeded random number generator (mulberry32), so a screenshot scene with
// ?seed=N always plays out the same way. The live game seeds it from Math.random.

export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random float in [min, max). */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** A random integer in [min, max]. */
export function rangeInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** One random element of an array. */
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

/** A copy of an array shuffled in place (Fisher-Yates). */
export function shuffle(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
