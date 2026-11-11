/*
 * Where everything in the town stands, in metres. world.js builds from these numbers and
 * path.test.js checks the camera against them, so the two can never drift apart.
 * The lake is everything west of BANK_X. The town climbs south (toward -z) from the shore.
 */
export const BANK_X = 4;          // lake to the west, land to the east
export const LOW_Y = 0.6;         // top of the shore strip
export const PLATEAU_Y = 10;      // the old town sits on a terrace
export const WALL_Z = -16;        // the terrace wall the stair climbs
export const STREET_X = 18;       // centre line of the stair, the street and the church
export const STREET_W = 6;

export const STAIR = { x: STREET_X, w: 4, zBottom: 2, zTop: WALL_Z, steps: 36, yBottom: LOW_Y, yTop: PLATEAU_Y };
export const stairRise = (STAIR.yTop - STAIR.yBottom) / STAIR.steps;
export const stairRun = (STAIR.zBottom - STAIR.zTop) / STAIR.steps;

/* Six houses a side. Stone ground floor, timber upper floor, hipped roof. */
export const HOUSE = { ground: 3.2, upper: 3.4, roof: 2.2, depth: 5, length: 6, gap: 1.2, overhang: 0.6 };
export const HOUSE_TOP = PLATEAU_Y + HOUSE.ground + HOUSE.upper + HOUSE.roof;
export const houses = [];
for (let i = 0; i < 6; i++) {
  const zFront = -20 - i * (HOUSE.length + HOUSE.gap);
  for (const side of [-1, 1]) {
    const inner = STREET_X + side * (STREET_W / 2 + 0.5); // street-facing wall
    const outer = inner + side * HOUSE.depth;
    houses.push({ side, i, x0: Math.min(inner, outer), x1: Math.max(inner, outer), z0: zFront - HOUSE.length, z1: zFront });
  }
}

/* A candle on every third step, both sides of the stair. */
export const CANDLE_STEPS = [];
for (let i = 1; i < STAIR.steps; i += 3) CANDLE_STEPS.push(i);
export const CANDLE_COUNT = CANDLE_STEPS.length * 2;

/* Parol strings: six across the street at the upper floors, two across the plaza. `n` parols on each. */
export const PAROL_STRINGS = [
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ x0: STREET_X - 2.9, x1: STREET_X + 2.9, y: PLATEAU_Y + HOUSE.ground + HOUSE.upper - 0.2, z: -23 - i * 7.2, n: 3, sag: 0.5 })),
  ...[-66.5, -71.5].map((z) => ({ x0: 9.5, x1: 26.5, y: PLATEAU_Y + 5.4, z, n: 5, sag: 0.8 })),
];
export const PAROL_COUNT = PAROL_STRINGS.reduce((s, r) => s + r.n, 0);

export const PLAZA = { z0: -76, z1: -64 };
export const CHURCH = {
  facade: { x0: 7, x1: 29, z0: -78, z1: -76, top: PLATEAU_Y + 22, peak: PLATEAU_Y + 27 },
  nave: { x0: 9, x1: 27, z0: -126, z1: -78, top: PLATEAU_Y + 18 },
  tower: { x0: 30, x1: 37, z0: -84, z1: -77, top: PLATEAU_Y + 30, dome: PLATEAU_Y + 34 },
};

export const VOLCANO = { x: -60, z: 130, r: 46, h: 20 };
export const MOON = { x: -154, y: 95, z: 334, r: 15 };
/*
 * The name, standing on the far water past the volcano. (x, z) is on the opening shot's centre line; the word is
 * `w` wide and its middle sits `shift` metres to the right of that line (negative: left), so it ends on the slope.
 */
export const MARK = { x: -37, z: 236, w: 148, shift: -44 };
export const BANGKA = { x: -18, z: 31, heading: 1.3 };

/* Height of whatever the camera would stand on at (x, z). */
export function groundAt(x, z) {
  if (x < BANK_X) return 0;
  if (z <= WALL_Z) return PLATEAU_Y;
  if (Math.abs(x - STAIR.x) <= STAIR.w / 2 + 0.6 && z <= STAIR.zBottom) {
    return STAIR.yBottom + (STAIR.zBottom - z) * ((STAIR.yTop - STAIR.yBottom) / (STAIR.zBottom - STAIR.zTop));
  }
  return LOW_Y;
}

/* Boxes the camera must stay out of: every house, the church and its tower. */
export const solids = [
  ...houses.map((h) => ({ x0: h.x0, x1: h.x1, y0: PLATEAU_Y, y1: HOUSE_TOP, z0: h.z0, z1: h.z1 })),
  { ...CHURCH.facade, y0: PLATEAU_Y, y1: CHURCH.facade.peak },
  { ...CHURCH.nave, y0: PLATEAU_Y, y1: CHURCH.nave.top + 4 },
  { ...CHURCH.tower, y0: PLATEAU_Y, y1: CHURCH.tower.dome },
];
