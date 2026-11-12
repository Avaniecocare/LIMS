import { gstStateByName } from './india.js';

/**
 * The state a PIN code belongs to, from its first digits alone (the postal circle and sorting district). Used only
 * when the PIN directory has no record of it, as happens for newer PIN codes. A few districts straddle a border;
 * those take the state that holds most of their PIN codes, and the person can still change it.
 */
const BY_FOUR: [number, number, string][] = [
  [2476, 2477, 'Uttarakhand'], // Roorkee and around
  [2625, 2629, 'Uttarakhand'], // Pithoragarh and Champawat
  [3962, 3962, 'Dadra and Nagar Haveli and Daman and Diu'],
  [6820, 6825, 'Kerala'],
];
const BY_THREE: [number, number, string][] = [
  [110, 110, 'Delhi'],
  [121, 136, 'Haryana'],
  [140, 159, 'Punjab'],
  [160, 160, 'Chandigarh'],
  [171, 177, 'Himachal Pradesh'],
  [180, 193, 'Jammu and Kashmir'],
  [194, 194, 'Ladakh'],
  [201, 245, 'Uttar Pradesh'],
  [246, 246, 'Uttarakhand'],
  [247, 247, 'Uttar Pradesh'],
  [248, 249, 'Uttarakhand'],
  [250, 262, 'Uttar Pradesh'],
  [263, 263, 'Uttarakhand'],
  [264, 285, 'Uttar Pradesh'],
  [301, 345, 'Rajasthan'],
  [360, 396, 'Gujarat'],
  [400, 402, 'Maharashtra'],
  [403, 403, 'Goa'],
  [404, 445, 'Maharashtra'],
  [450, 488, 'Madhya Pradesh'],
  [490, 497, 'Chhattisgarh'],
  [500, 509, 'Telangana'],
  [515, 535, 'Andhra Pradesh'],
  [560, 591, 'Karnataka'],
  [600, 643, 'Tamil Nadu'],
  [670, 695, 'Kerala'],
  [737, 737, 'Sikkim'],
  [744, 744, 'Andaman and Nicobar Islands'],
  [700, 743, 'West Bengal'],
  [751, 770, 'Odisha'],
  [781, 788, 'Assam'],
  [790, 792, 'Arunachal Pradesh'],
  [793, 794, 'Meghalaya'],
  [795, 795, 'Manipur'],
  [796, 796, 'Mizoram'],
  [797, 798, 'Nagaland'],
  [799, 799, 'Tripura'],
  [800, 813, 'Bihar'],
  [814, 816, 'Jharkhand'],
  [817, 821, 'Bihar'],
  [822, 822, 'Jharkhand'],
  [823, 824, 'Bihar'],
  [825, 835, 'Jharkhand'],
  [841, 855, 'Bihar'],
];

export function stateForPin(pin: string): { code: string; name: string } | null {
  if (!/^[1-9][0-9]{5}$/.test(pin)) return null;
  const four = Number(pin.slice(0, 4));
  const three = Number(pin.slice(0, 3));
  const hit = BY_FOUR.find(([a, b]) => four >= a && four <= b) ?? BY_THREE.find(([a, b]) => three >= a && three <= b);
  return hit ? gstStateByName(hit[2]) : null;
}

/** PIN codes near this one in the same sorting district (same first three digits), closest first. */
export function nearbyPins(pin: string, reach = 8): string[] {
  const n = Number(pin);
  const out: string[] = [];
  for (let d = 1; d <= reach; d++) {
    for (const c of [n + d, n - d]) {
      const s = String(c);
      if (s.length === 6 && s.slice(0, 3) === pin.slice(0, 3)) out.push(s);
    }
  }
  return out;
}
