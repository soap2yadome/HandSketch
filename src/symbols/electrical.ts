import { A, E, L, P, PF, R, T, head, type SymbolDef } from './types';

const two: SymbolDef['ports'] = [[0, 24], [48, 24]];

export const electrical: SymbolDef[] = [
  // ---- Schematic symbols (IEEE 315 / IEC 60617 style) ----
  {
    id: 'resistor', label: 'Resistor', domain: 'electrical', keywords: 'ohm schematic',
    prims: [P([0, 24, 8, 24, 11, 16, 17, 32, 23, 16, 29, 32, 35, 16, 38, 24, 48, 24])], ports: two,
  },
  {
    id: 'capacitor', label: 'Capacitor', domain: 'electrical', keywords: 'schematic farad',
    prims: [L(0, 24, 20, 24), L(20, 10, 20, 38), L(28, 10, 28, 38), L(28, 24, 48, 24)], ports: two,
  },
  {
    id: 'inductor', label: 'Inductor', domain: 'electrical', keywords: 'coil choke henry schematic',
    prims: [L(0, 24, 8, 24), A(12, 24, 4, 180, 360), A(20, 24, 4, 180, 360), A(28, 24, 4, 180, 360), A(36, 24, 4, 180, 360), L(40, 24, 48, 24)],
    ports: two,
  },
  {
    id: 'diode', label: 'Diode', domain: 'electrical', keywords: 'rectifier schematic',
    prims: [L(0, 24, 14, 24), P([14, 12, 14, 36, 34, 24], true), L(34, 12, 34, 36), L(34, 24, 48, 24)], ports: two,
  },
  {
    id: 'led', label: 'LED', domain: 'electrical', keywords: 'light emitting diode schematic',
    prims: [L(0, 24, 14, 24), P([14, 12, 14, 36, 34, 24], true), L(34, 12, 34, 36), L(34, 24, 48, 24),
      L(20, 10, 28, 2), head(20, 10, 28, 2), L(27, 14, 35, 6), head(27, 14, 35, 6)],
    ports: two,
  },
  {
    id: 'battery', label: 'Battery', domain: 'electrical', keywords: 'dc cell power schematic',
    prims: [L(0, 24, 18, 24), L(18, 10, 18, 38), L(24, 17, 24, 31), L(30, 10, 30, 38), L(36, 17, 36, 31), L(36, 24, 48, 24), T(8, 18, '+', 10)],
    ports: two,
  },
  {
    id: 'ground', label: 'Ground', domain: 'electrical', keywords: 'earth gnd schematic',
    prims: [L(24, 0, 24, 20), L(10, 20, 38, 20), L(16, 28, 32, 28), L(21, 36, 27, 36)], ports: [[24, 0]],
  },
  {
    id: 'ac-source', label: 'AC Source', domain: 'electrical', keywords: 'generator supply sine schematic',
    prims: [L(0, 24, 10, 24), E(24, 24, 14, 14), A(19, 24, 5, 180, 360), A(29, 24, 5, 0, 180), L(38, 24, 48, 24)], ports: two,
  },
  {
    id: 'switch-spst', label: 'Switch (SPST)', domain: 'electrical', keywords: 'toggle schematic',
    prims: [L(0, 24, 10, 24), E(12, 24, 2, 2), E(36, 24, 2, 2), L(13, 23, 34, 11), L(38, 24, 48, 24)], ports: two,
  },
  {
    id: 'npn', label: 'NPN Transistor', domain: 'electrical', keywords: 'bjt schematic',
    prims: [E(24, 24, 20, 20), L(0, 24, 16, 24), L(16, 12, 16, 36), L(16, 20, 36, 8), L(36, 8, 36, 0), L(16, 28, 36, 40), L(36, 40, 36, 48), head(16, 28, 36, 40, 5)],
    ports: [[0, 24], [36, 0], [36, 48]],
  },
  {
    id: 'pnp', label: 'PNP Transistor', domain: 'electrical', keywords: 'bjt schematic',
    prims: [E(24, 24, 20, 20), L(0, 24, 16, 24), L(16, 12, 16, 36), L(16, 20, 36, 8), L(36, 8, 36, 0), L(16, 28, 36, 40), L(36, 40, 36, 48), head(36, 40, 16, 28, 5)],
    ports: [[0, 24], [36, 0], [36, 48]],
  },
  {
    id: 'op-amp', label: 'Op-Amp', domain: 'electrical', keywords: 'amplifier schematic',
    prims: [P([8, 4, 8, 44, 44, 24], true), T(12, 20, '-', 11), T(12, 36, '+', 11), L(0, 16, 8, 16), L(0, 32, 8, 32), L(44, 24, 48, 24), L(24, 0, 24, 14), L(24, 34, 24, 48)],
    ports: [[0, 16], [0, 32], [48, 24], [24, 0], [24, 48]],
  },
  {
    id: 'fuse', label: 'Fuse', domain: 'electrical', keywords: 'protection breaker schematic',
    prims: [L(0, 24, 12, 24), R(12, 18, 24, 12), L(12, 24, 36, 24), L(36, 24, 48, 24)], ports: two,
  },
  {
    id: 'transformer', label: 'Transformer', domain: 'electrical', keywords: 'xfmr schematic',
    prims: [A(14, 11, 4, 270, 450), A(14, 19, 4, 270, 450), A(14, 27, 4, 270, 450), A(14, 35, 4, 270, 450),
      A(34, 11, 4, 90, 270), A(34, 19, 4, 90, 270), A(34, 27, 4, 90, 270), A(34, 35, 4, 90, 270),
      L(22, 6, 22, 42), L(26, 6, 26, 42), L(0, 7, 14, 7), L(0, 43, 14, 43), L(34, 7, 48, 7), L(34, 43, 48, 43)],
    ports: [[0, 7], [0, 43], [48, 7], [48, 43]],
  },
  {
    id: 'lamp', label: 'Lamp', domain: 'electrical', keywords: 'bulb indicator schematic',
    prims: [L(0, 24, 10, 24), E(24, 24, 14, 14), L(14, 14, 34, 34), L(34, 14, 14, 34), L(38, 24, 48, 24)], ports: two,
  },
  // ---- Building electrical plan symbols ----
  {
    id: 'duplex-outlet', label: 'Duplex Outlet', domain: 'electrical', keywords: 'receptacle plug socket plan',
    prims: [E(24, 24, 9, 9), L(8, 24, 40, 24)], ports: [[24, 15], [24, 33]],
  },
  {
    id: 'gfci-outlet', label: 'GFCI Outlet', domain: 'electrical', keywords: 'gfi receptacle ground fault plan',
    prims: [E(24, 20, 9, 9), L(8, 20, 40, 20), T(24, 42, 'GFCI', 9)], ports: [[24, 11], [24, 29]],
  },
  {
    id: 'switch-sp', label: 'Switch', domain: 'electrical', keywords: 'single pole light switch plan',
    prims: [T(24, 30, 'S', 24), L(24, 36, 24, 44)], ports: [[24, 44]],
  },
  {
    id: 'switch-3way', label: '3-Way Switch', domain: 'electrical', keywords: 'three way switch plan',
    prims: [T(24, 30, 'S3', 22), L(24, 36, 24, 44)], ports: [[24, 44]],
  },
  {
    id: 'ceiling-light', label: 'Ceiling Light', domain: 'electrical', keywords: 'luminaire fixture plan',
    prims: [E(24, 24, 11, 11), L(16, 16, 32, 32), L(32, 16, 16, 32)], ports: [[24, 13], [24, 35], [13, 24], [35, 24]],
  },
  {
    id: 'recessed-light', label: 'Recessed Light', domain: 'electrical', keywords: 'can downlight plan',
    prims: [R(9, 9, 30, 30), E(24, 24, 9, 9), L(18, 18, 30, 30), L(30, 18, 18, 30)], ports: [[24, 9], [24, 39], [9, 24], [39, 24]],
  },
  {
    id: 'junction-box', label: 'Junction Box', domain: 'electrical', keywords: 'jbox plan',
    prims: [E(24, 24, 10, 10), T(24, 29, 'J', 14)], ports: [[24, 14], [24, 34], [14, 24], [34, 24]],
  },
  {
    id: 'panel', label: 'Panel', domain: 'electrical', keywords: 'breaker distribution board plan',
    prims: [R(8, 4, 32, 40), L(8, 4, 40, 44), L(8, 24, 24, 44), L(24, 4, 40, 24)], ports: [[8, 24], [40, 24], [24, 4], [24, 44]],
  },
  {
    id: 'smoke-detector', label: 'Smoke Detector', domain: 'electrical', keywords: 'fire alarm nfpa 170 plan',
    prims: [E(24, 24, 11, 11), T(24, 29, 'S', 14)], ports: [[24, 13], [24, 35]],
  },
  {
    id: 'thermostat', label: 'Thermostat', domain: 'electrical', keywords: 'hvac control plan',
    prims: [E(24, 24, 11, 11), T(24, 29, 'T', 14)], ports: [[24, 13], [24, 35]],
  },
  {
    id: 'meter', label: 'Meter', domain: 'electrical', keywords: 'kwh utility',
    prims: [E(24, 24, 14, 14), T(24, 29, 'M', 14), PF([22, 38, 26, 38, 24, 40])], ports: [[24, 10], [24, 38]],
  },
];

