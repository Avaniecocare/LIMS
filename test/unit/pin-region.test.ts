import { describe, expect, it } from 'vitest';
import { nearbyPins, stateForPin } from '../../src/common/pin-region.js';

describe("state from a PIN code's first digits", () => {
  it.each([
    ['201318', 'Uttar Pradesh'],
    ['110001', 'Delhi'],
    ['122018', 'Haryana'],
    ['160017', 'Chandigarh'],
    ['248001', 'Uttarakhand'],
    ['247667', 'Uttarakhand'],
    ['247001', 'Uttar Pradesh'],
    ['403001', 'Goa'],
    ['400701', 'Maharashtra'],
    ['560103', 'Karnataka'],
    ['500081', 'Telangana'],
    ['737101', 'Sikkim'],
    ['744101', 'Andaman and Nicobar Islands'],
    ['700001', 'West Bengal'],
    ['834001', 'Jharkhand'],
    ['800001', 'Bihar'],
    ['194101', 'Ladakh'],
    ['799001', 'Tripura'],
  ])('%s is in %s', (pin, state) => {
    expect(stateForPin(pin)?.name).toBe(state);
  });
  it('knows nothing for unused ranges or bad input', () => {
    expect(stateForPin('999999')).toBeNull();
    expect(stateForPin('012345')).toBeNull();
    expect(stateForPin('2013')).toBeNull();
  });
});

describe('nearby PIN codes', () => {
  it('closest first, and only in the same sorting district', () => {
    expect(nearbyPins('201318', 2)).toEqual(['201319', '201317', '201320', '201316']);
    expect(nearbyPins('201999', 2)).toEqual(['201998', '201997']);
  });
});
