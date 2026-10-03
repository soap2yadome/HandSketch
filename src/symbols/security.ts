import { A, AE, D, E, L, P, R, T, arrow, type SymbolDef } from './types';

const dots = (xs: number[], ys: number[]) => ys.flatMap((y) => xs.map((x) => D(x, y, 1.6)));

export const security: SymbolDef[] = [
  {
    id: 'card-reader', label: 'Card Reader', domain: 'security', keywords: 'proximity rfid badge access',
    prims: [R(14, 4, 20, 40), R(18, 8, 12, 8), A(24, 32, 4, -135, -45), A(24, 32, 8, -135, -45), A(24, 32, 12, -135, -45), D(24, 33, 1.5)],
    ports: [[24, 44], [14, 24], [34, 24]],
  },
  {
    id: 'keypad', label: 'Keypad', domain: 'security', keywords: 'pin code access',
    prims: [R(10, 4, 28, 40), ...dots([16, 24, 32], [14, 22, 30]), D(24, 38, 1.6)],
    ports: [[24, 44], [10, 24], [38, 24]],
  },
  {
    id: 'biometric-reader', label: 'Biometric Reader', domain: 'security', keywords: 'fingerprint iris access',
    prims: [R(10, 4, 28, 40), A(24, 30, 4, 180, 360), A(24, 30, 8, 180, 360), A(24, 30, 12, 180, 360), L(24, 30, 24, 38), R(15, 8, 18, 6)],
    ports: [[24, 44], [10, 24], [38, 24]],
  },
  {
    id: 'electric-strike', label: 'Electric Strike', domain: 'security', keywords: 'lock door hardware',
    prims: [R(6, 4, 14, 38), R(11, 14, 6, 14), L(20, 21, 34, 21), T(34, 44, 'ES', 10)],
    ports: [[13, 4], [13, 42]],
  },
  {
    id: 'maglock', label: 'Maglock', domain: 'security', keywords: 'magnetic lock door hardware',
    prims: [R(6, 8, 36, 12), R(6, 26, 36, 10), L(24, 20, 24, 26), P([8, 42, 14, 38, 20, 42, 26, 38, 32, 42, 38, 38])],
    ports: [[24, 8], [24, 42]],
  },
  {
    id: 'door-contact', label: 'Door Contact', domain: 'security', keywords: 'dps magnetic reed sensor position',
    prims: [R(4, 18, 14, 12), R(30, 18, 14, 12), L(19, 24, 22, 24), L(26, 24, 29, 24), D(11, 24, 1.4)],
    ports: [[4, 24], [44, 24]],
  },
  {
    id: 'rex', label: 'Request to Exit', domain: 'security', keywords: 'rex button egress pir',
    prims: [R(8, 4, 32, 38), T(24, 18, 'EXIT', 9), E(24, 30, 7, 7), D(24, 30, 1.8)],
    ports: [[24, 42], [8, 22], [40, 22]],
  },
  {
    id: 'pir-sensor', label: 'Motion Sensor', domain: 'security', keywords: 'pir detector intrusion',
    prims: [A(24, 34, 14, 180, 360), L(10, 34, 38, 34), L(24, 20, 24, 34), A(24, 34, 20, 200, 340), A(24, 34, 26, 215, 325)],
    ports: [[24, 34], [10, 34], [38, 34]],
  },
  {
    id: 'cctv-dome', label: 'Dome Camera', domain: 'security', keywords: 'cctv surveillance video',
    prims: [A(24, 30, 16, 180, 360), R(4, 30, 40, 6), E(24, 25, 5, 5), D(24, 25, 1.6)],
    ports: [[24, 36], [24, 14]],
  },
  {
    id: 'cctv-bullet', label: 'Bullet Camera', domain: 'security', keywords: 'cctv surveillance video',
    prims: [R(6, 16, 28, 14), P([34, 16, 44, 11, 44, 35, 34, 30], true), L(20, 30, 20, 38), L(12, 40, 28, 40)],
    ports: [[20, 40], [6, 23]],
  },
  {
    id: 'cctv-ptz', label: 'PTZ Camera', domain: 'security', keywords: 'cctv pan tilt zoom surveillance',
    prims: [A(24, 22, 11, 180, 360), R(13, 22, 22, 5), E(24, 19, 3.5, 3.5), L(24, 27, 24, 42),
      ...arrow(9, 36, 4, 28), ...arrow(39, 36, 44, 28)],
    ports: [[24, 42], [24, 11]],
  },
  {
    id: 'nvr-dvr', label: 'NVR / DVR', domain: 'security', keywords: 'recorder video',
    prims: [R(4, 14, 40, 22), L(8, 26, 26, 26), D(34, 26, 1.6), D(38, 20, 1.2), T(24, 11, 'NVR', 8)],
    ports: [[4, 25], [44, 25]],
  },
  {
    id: 'access-controller', label: 'Access Controller', domain: 'security', keywords: 'panel acp door controller',
    prims: [R(6, 4, 36, 40), R(12, 9, 24, 14), T(24, 38, 'ACP', 9), L(6, 14, 0, 14), L(6, 26, 0, 26), L(42, 14, 48, 14), L(42, 26, 48, 26)],
    ports: [[0, 14], [0, 26], [48, 14], [48, 26]],
  },
  {
    id: 'intercom', label: 'Intercom', domain: 'security', keywords: 'video door station',
    prims: [R(10, 4, 24, 40), L(14, 10, 30, 10), L(14, 14, 30, 14), E(22, 24, 4, 4), D(22, 36, 2.4)],
    ports: [[22, 44], [10, 24], [34, 24]],
  },
  {
    id: 'alarm-siren', label: 'Siren / Horn', domain: 'security', keywords: 'strobe alarm notification',
    prims: [P([8, 18, 18, 18, 34, 8, 34, 40, 18, 30, 8, 30], true), AE(34, 24, 5, 8, -60, 60), AE(34, 24, 9, 14, -60, 60)],
    ports: [[8, 24]],
  },
  {
    id: 'keyfob', label: 'Key Fob', domain: 'security', keywords: 'credential remote',
    prims: [R(14, 10, 20, 34), E(24, 5, 4, 4), D(24, 19, 2.4), D(24, 28, 2.4), D(24, 36, 1.8)],
    ports: [],
  },
  {
    id: 'turnstile', label: 'Turnstile', domain: 'security', keywords: 'gate speed gate barrier',
    prims: [E(24, 24, 3, 3), L(24, 24, 24, 5), L(24, 24, 8, 33), L(24, 24, 40, 33), A(24, 24, 20, 190, 350)],
    ports: [[24, 24]],
  },
  {
    id: 'glass-break', label: 'Glass-Break Sensor', domain: 'security', keywords: 'acoustic window sensor',
    prims: [R(8, 6, 32, 32), P([24, 6, 20, 16, 28, 22, 22, 30, 24, 38]), A(24, 44, 6, 200, 340)],
    ports: [[24, 38]],
  },
  {
    id: 'power-supply', label: 'Power Supply', domain: 'security', keywords: 'psu battery backup 12v 24v',
    prims: [R(6, 10, 36, 28), T(24, 29, 'PS', 14), L(0, 24, 6, 24), L(42, 18, 48, 18), L(42, 30, 48, 30)],
    ports: [[0, 24], [48, 18], [48, 30]],
  },
  {
    id: 'emergency-exit', label: 'Emergency Exit', domain: 'security', keywords: 'break glass pull station egress',
    prims: [R(8, 6, 32, 32), R(14, 12, 20, 20), P([22, 14, 26, 22, 22, 26, 26, 30]), T(24, 46, 'EXIT', 8)],
    ports: [[24, 38]],
  },
  {
    id: 'door', label: 'Door (plan)', domain: 'security', keywords: 'swing leaf opening',
    prims: [L(0, 42, 48, 42), L(8, 42, 8, 10), A(8, 42, 32, 270, 360)],
    ports: [[8, 42], [40, 42]],
  },
];
