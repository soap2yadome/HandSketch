import { A, AE, D, E, L, P, R, T, arrow, type SymbolDef } from './types';

const four = (): SymbolDef['ports'] => [[24, 4], [44, 24], [24, 44], [4, 24]];

export const network: SymbolDef[] = [
  {
    id: 'router', label: 'Router', domain: 'network', keywords: 'gateway layer 3',
    prims: [E(24, 24, 20, 20), ...arrow(24, 24, 24, 9), ...arrow(24, 24, 24, 39), ...arrow(24, 24, 9, 24), ...arrow(24, 24, 39, 24)],
    ports: four(),
  },
  {
    id: 'switch', label: 'Switch', domain: 'network', keywords: 'layer 2 ethernet',
    prims: [R(4, 14, 40, 20), ...arrow(10, 20, 38, 20), ...arrow(38, 28, 10, 28)],
    ports: [[4, 24], [44, 24], [24, 14], [24, 34]],
  },
  {
    id: 'l3-switch', label: 'L3 Switch', domain: 'network', keywords: 'layer 3 multilayer core',
    prims: [R(4, 14, 40, 20), ...arrow(24, 24, 24, 17), ...arrow(24, 24, 24, 31), ...arrow(24, 24, 11, 24), ...arrow(24, 24, 37, 24)],
    ports: [[4, 24], [44, 24], [24, 14], [24, 34]],
  },
  {
    id: 'firewall', label: 'Firewall', domain: 'network', keywords: 'security utm ngfw',
    prims: [R(4, 8, 40, 32), L(4, 18, 44, 18), L(4, 28, 44, 28), L(18, 8, 18, 18), L(32, 18, 32, 28), L(18, 28, 18, 40)],
    ports: four(),
  },
  {
    id: 'server', label: 'Server', domain: 'network', keywords: 'rack host',
    prims: [R(12, 4, 24, 40), L(12, 16, 36, 16), L(12, 28, 36, 28), D(17, 10), D(17, 22), L(22, 36, 32, 36)],
    ports: [[24, 4], [24, 44], [12, 22], [36, 22]],
  },
  {
    id: 'workstation', label: 'Workstation', domain: 'network', keywords: 'pc desktop computer',
    prims: [R(6, 4, 36, 26), R(10, 8, 28, 18), L(24, 30, 24, 36), L(14, 37, 34, 37), R(8, 39, 32, 5)],
    ports: [[24, 4], [24, 44], [6, 17], [42, 17]],
  },
  {
    id: 'laptop', label: 'Laptop', domain: 'network', keywords: 'notebook',
    prims: [P([10, 10, 38, 10, 38, 30, 10, 30], true), P([4, 34, 44, 34, 40, 40, 8, 40], true)],
    ports: [[4, 34], [44, 34], [24, 40]],
  },
  {
    id: 'wireless-ap', label: 'Wireless AP', domain: 'network', keywords: 'wifi access point wlan',
    prims: [R(8, 32, 32, 10), L(24, 32, 24, 24), A(24, 22, 7, -140, -40), A(24, 22, 13, -140, -40), A(24, 22, 19, -140, -40), D(24, 22, 1.8)],
    ports: [[24, 42], [8, 37], [40, 37]],
  },
  {
    id: 'cloud', label: 'Cloud / Internet', domain: 'network', keywords: 'wan isp',
    prims: [A(14, 30, 8, 90, 270), A(21, 20, 10, 180, 330), A(33, 22, 9, 220, 380), A(36, 31, 8, -90, 90), L(14, 38, 36, 38)],
    ports: [[6, 30], [44, 31], [24, 10], [24, 38]],
  },
  {
    id: 'load-balancer', label: 'Load Balancer', domain: 'network', keywords: 'adc lb',
    prims: [R(6, 8, 36, 32), ...arrow(0, 24, 14, 24), ...arrow(14, 24, 30, 14), ...arrow(14, 24, 32, 24), ...arrow(14, 24, 30, 34)],
    ports: [[0, 24], [42, 14], [42, 24], [42, 34]],
  },
  {
    id: 'database', label: 'Database', domain: 'network', keywords: 'db storage sql',
    prims: [E(24, 10, 16, 6), L(8, 10, 8, 38), L(40, 10, 40, 38), AE(24, 38, 16, 6, 0, 180), AE(24, 24, 16, 6, 0, 180)],
    ports: [[24, 4], [24, 44], [8, 24], [40, 24]],
  },
  {
    id: 'printer', label: 'Printer', domain: 'network', keywords: 'mfp',
    prims: [R(12, 4, 24, 12), R(4, 16, 40, 18), R(12, 28, 24, 16), D(38, 22, 1.5)],
    ports: [[4, 25], [44, 25]],
  },
  {
    id: 'ip-phone', label: 'IP Phone', domain: 'network', keywords: 'voip telephone',
    prims: [R(6, 18, 36, 22), P([8, 18, 10, 10, 38, 10, 40, 18]), R(26, 24, 12, 12), L(6, 43, 42, 43)],
    ports: [[24, 44], [6, 29]],
  },
  {
    id: 'ip-camera', label: 'IP Camera', domain: 'network', keywords: 'cctv surveillance poe',
    prims: [R(6, 16, 28, 14), P([34, 16, 44, 12, 44, 34, 34, 30], true), L(20, 30, 20, 38), L(12, 40, 28, 40), D(10, 23, 1.4)],
    ports: [[20, 40], [6, 23]],
  },
  {
    id: 'nas', label: 'NAS / Storage', domain: 'network', keywords: 'san disk array',
    prims: [R(8, 6, 32, 36), R(12, 10, 24, 6), R(12, 20, 24, 6), R(12, 30, 24, 6), D(36, 13, 1.4)],
    ports: [[24, 42], [8, 24], [40, 24]],
  },
  {
    id: 'modem', label: 'Modem', domain: 'network', keywords: 'cable dsl ont',
    prims: [R(6, 24, 36, 14), L(14, 24, 12, 8), L(34, 24, 36, 8), D(14, 31), D(21, 31), D(28, 31), T(36, 35, '', 8)],
    ports: [[6, 31], [42, 31], [24, 38]],
  },
];
