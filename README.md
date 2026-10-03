# HandSketch

Hand-drawn-style **PDF markup** and **technical diagramming** that runs entirely in your browser.
Redline a drawing set with sketchy clouds, arrows, stamps and notes — or build a network, electrical
or security/access-control diagram from a built-in symbol library. Nothing is uploaded: your PDF
never leaves the page.

## Features

- **PDF markup** — open any PDF, mark up each page with pen, highlighter, lines, arrows, rectangles,
  ellipses, **revision clouds**, highlight boxes, text and rubber **stamps** (APPROVED, REJECTED,
  REVISE, AS-BUILT, …). Rotated pages and cropped pages are handled.
- **Annotated PDF export** — markup is embedded over the original pages (the original file is kept
  intact when you only annotate). Also export PNG or SVG of a page.
- **Symbol library (55+ symbols)** drawn in the same sketchy style:
  - **Network** — router, switch, L3 switch, firewall, server, workstation, laptop, wireless AP,
    cloud/internet, load balancer, database, printer, IP phone, IP camera, NAS, modem.
  - **Electrical** — schematic symbols (resistor, capacitor, inductor, diode, LED, battery, ground,
    AC source, switch, NPN/PNP, op-amp, fuse, transformer, lamp) and building-plan symbols
    (duplex/GFCI outlet, switches, ceiling/recessed light, junction box, panel, smoke detector,
    thermostat, meter).
  - **Security / access control** — card reader, keypad, biometric reader, electric strike, maglock,
    door contact, request-to-exit, PIR, dome/bullet/PTZ cameras, NVR/DVR, access controller,
    intercom, siren, key fob, turnstile, glass-break sensor, power supply, emergency exit, door.
- **Smart connectors** — symbols expose connection ports. Draw a Line/Arrow tool from one port to
  another and it stays attached when you move the symbols. Straight or elbow routing, optional
  cable/circuit labels.
- Select, move, resize, rotate, label, duplicate, copy/paste, z-order, undo/redo, snap-to-grid.
- Save/open **project files** (`.handsketch.json`, embeds the PDF). Work **autosaves** locally
  (IndexedDB).
- Pan with Space+drag, Ctrl+scroll to zoom, drag & drop a PDF anywhere.

Press `?` in the app for shortcuts.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit tests (vitest): geometry, symbols, connectors, PDF export incl. rotated/cropped pages
npm run test:e2e     # browser tests (Playwright + Chromium); builds and serves the app itself
npm run build        # static site in dist/ (base path /HandSketch/)
```

If Playwright can't download its browser, point `CHROMIUM_PATH` at a local Chromium binary.
Set `BASE_PATH=/` to build for a root-level host.

## How it works

| File | Role |
| --- | --- |
| `src/sketch.ts` | Hand-drawn geometry engine (seeded wobble, hachure, ellipses, arcs) — pure functions returning polylines |
| `src/render.ts` | Elements → drawing primitives; port math, elbow routing, hit-testing |
| `src/paint.ts` | Paints primitives to Canvas 2D or SVG |
| `src/symbols/*` | Symbol library as 48×48 primitive recipes plus connection ports |
| `src/export.ts` | Rasterises markup per page and embeds it with pdf-lib (CropBox + `/Rotate` aware) |
| `src/pdf.ts` | pdf.js rendering (legacy build, for broad browser support) |
| `src/main.ts` | Editor UI: tools, selection, properties, pages, autosave |

Shapes use a per-element random seed, so a sketch looks identical on screen, in PNG, SVG and PDF.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to **GitHub Pages** on every push to `main`
(`https://<user>.github.io/HandSketch/`). In the repo settings choose **Pages → Source: GitHub
Actions**. Note: GitHub Pages for a *private* repository requires a paid GitHub plan (Pro/Team/Enterprise);
on the Free plan the repository must be public. `ci.yml` runs typecheck, unit and e2e tests on every push.

## Notes & limitations

- Exported annotations are raster overlays (transparent PNG, up to 3×), so markup is not selectable
  text in the output PDF; the original PDF content stays vector. Large page sizes are capped.
- Encrypted/password-protected PDFs are not supported.
- Symbols are original line-art based on common schematic conventions (IEEE 315 / IEC 60617 /
  NFPA 170 style). They are *inspired by*, not certified to, those standards, and contain no vendor
  artwork. Don't rely on them for code-compliance submittals without review.
- Handwriting font: [Caveat](https://fonts.google.com/specimen/Caveat) (SIL OFL), bundled via Fontsource.

## License

MIT — see [LICENSE](LICENSE).
