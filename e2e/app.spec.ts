import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { copyFileSync, readFileSync } from 'node:fs';

async function fixturePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(`Floor plan sheet ${i + 1}`, { x: 60, y: 720, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
    p.drawRectangle({ x: 60, y: 300, width: 480, height: 360, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 2 });
    if (i === 1) p.setRotation(degrees(90));
  }
  return Buffer.from(await pdf.save());
}

type St = { doc: { pages: { kind: string; elements: Record<string, any>[] }[] }; zoom: number; pageIdx: number };
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__handsketch.state;
  return JSON.parse(JSON.stringify({ doc: s.doc, zoom: s.zoom, pageIdx: s.pageIdx })) as St;
});
const els = async (page: Page) => (await state(page)).doc.pages[(await state(page)).pageIdx].elements;

/** Page-space point -> client coordinates. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('#ink-canvas').boundingBox())!;
  const z = (await state(page)).zoom;
  return { x: box.x + x * z, y: box.y + y * z };
}
async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function dragTo(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const a = await at(page, x1, y1);
  const b = await at(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { throw e; });
  await page.goto('./');
  await expect(page.locator('.sym').first()).toBeVisible();
});

test('loads with tools, three symbol domains and no console errors', async ({ page }) => {
  await expect(page).toHaveTitle(/HandSketch/);
  await expect(page.locator('.tool')).toHaveCount(11);
  await expect(page.locator('.sym')).toHaveCount(await page.locator('.sym').count());
  expect(await page.locator('.sym').count()).toBeGreaterThanOrEqual(50);
  for (const d of ['Network', 'Electrical', 'Security / Access']) {
    await page.locator('.chip', { hasText: d }).click();
    expect(await page.locator('.sym').count()).toBeGreaterThanOrEqual(15);
  }
  await page.locator('.chip', { hasText: 'All' }).click();
  await page.fill('#sym-search', 'fingerprint');
  await expect(page.locator('.sym')).toHaveCount(1);
  await expect(page.locator('.sym')).toContainText('Biometric');
});

test('builds a connected network diagram and connectors follow moved symbols', async ({ page }) => {
  await page.click('#btn-new');
  await page.fill('#sym-search', '');
  await page.locator('.sym[data-symbol="router"]').click();
  await click(page, 240, 240);
  await page.locator('.sym[data-symbol="firewall"]').click();
  await click(page, 600, 240);
  await page.keyboard.press('Escape');
  let e = await els(page);
  expect(e.filter((x) => x.type === 'symbol')).toHaveLength(2);
  const [router, fw] = e.filter((x) => x.type === 'symbol');

  // Connect router east port -> firewall west port with the line tool
  await page.keyboard.press('l');
  const rEast = { x: router.x + router.size * (44 / 48), y: router.y + router.size / 2 };
  const fWest = { x: fw.x + fw.size * (4 / 48), y: fw.y + fw.size / 2 };
  await dragTo(page, rEast.x, rEast.y, fWest.x, fWest.y);
  e = await els(page);
  const wire = e.find((x) => x.type === 'line')!;
  expect(wire.from).toMatchObject({ id: router.id, port: 1 });
  expect(wire.to).toMatchObject({ id: fw.id, port: 3 });

  // Move the firewall: wire stays attached (renders to the new port position)
  await page.keyboard.press('v');
  await dragTo(page, fw.x + fw.size / 2, fw.y + fw.size / 2, fw.x + fw.size / 2, fw.y + fw.size / 2 + 120);
  e = await els(page);
  const moved = e.find((x) => x.id === fw.id)!;
  expect(moved.y).toBeGreaterThan(fw.y + 80);
  expect(e.find((x) => x.type === 'line')!.to.id).toBe(fw.id);

  // Undo restores position
  await page.keyboard.press('Control+z');
  e = await els(page);
  expect(e.find((x) => x.id === fw.id)!.y).toBeCloseTo(fw.y, 0);
  await page.keyboard.press('Control+Shift+z');
  e = await els(page);
  expect(e.find((x) => x.id === fw.id)!.y).toBeGreaterThan(fw.y + 80);
  await page.screenshot({ path: 'test-results/network-diagram.png' });
});

test('labels a symbol, rotates it and edits text', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="card-reader"]').click();
  await click(page, 300, 300);
  await page.keyboard.press('v');
  const sym = (await els(page)).find((x) => x.type === 'symbol')!;
  await click(page, sym.x + sym.size / 2, sym.y + sym.size / 2);
  await expect(page.locator('#props')).toBeVisible();
  await page.fill('#prop-label', 'CR-101');
  await page.locator('#prop-label').press('Enter');
  await page.keyboard.press('Tab');
  let s = (await els(page)).find((x) => x.type === 'symbol')!;
  expect(s.label).toBe('CR-101');
  await page.locator('#props button', { hasText: '⟳ Rotate' }).click();
  s = (await els(page)).find((x) => x.type === 'symbol')!;
  expect(s.rot).toBe(90);

  await page.keyboard.press('t');
  await click(page, 500, 150);
  await page.locator('[data-testid="text-editor"]').fill('Main lobby entrance');
  await page.keyboard.press('Control+Enter');
  const t = (await els(page)).find((x) => x.type === 'text')!;
  expect(t.text).toBe('Main lobby entrance');
});

test('marks up a PDF, exports an annotated PDF, and saves/reopens the project', async ({ page }, info) => {
  await page.setInputFiles('#file-pdf', { name: 'plans.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() });
  await expect(page.locator('#pg-label')).toHaveText('Page 1 / 3');
  await expect(page.locator('#pdf-canvas')).toHaveAttribute('data-rendered', '0');
  // the PDF canvas actually has ink on it (title text + rectangle border)
  const painted = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++;
    return dark;
  });
  expect(painted).toBeGreaterThan(500);

  // Revision cloud + arrow + text + stamp + pen
  await page.keyboard.press('c');
  await dragTo(page, 100, 330, 300, 450);
  await page.keyboard.press('a');
  await dragTo(page, 420, 520, 310, 440);
  await page.keyboard.press('t');
  await click(page, 380, 540);
  await page.locator('[data-testid="text-editor"]').fill('Move door here');
  await page.keyboard.press('Control+Enter');
  await page.selectOption('#st-stamp', { label: 'APPROVED' });
  await click(page, 400, 160);
  await page.keyboard.press('p');
  await dragTo(page, 80, 600, 200, 640);
  const e = await els(page);
  expect(e.map((x) => x.type).sort()).toEqual(['arrow', 'cloud', 'free', 'stamp', 'text']);

  // Page 2 is rotated; mark it too
  await page.click('#pg-next');
  await expect(page.locator('#pdf-canvas')).toHaveAttribute('data-rendered', '1');
  await page.keyboard.press('r');
  await dragTo(page, 50, 50, 250, 180);
  expect((await els(page)).filter((x) => x.type === 'rect')).toHaveLength(1);
  await page.screenshot({ path: 'test-results/pdf-markup.png' });

  // Export annotated PDF
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click().then(() => page.locator('#exp-pdf').click())]);
  expect(dl.suggestedFilename()).toBe('annotated.pdf');
  const out = await dl.path();
  const bytes = readFileSync(out!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(3);
  // pages 1 and 2 received an overlay image; page 3 did not
  const imageObjects = (bytes.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
  // each transparent PNG embeds as an image + soft-mask: 2 annotated pages => 4 image objects
  expect(imageObjects).toBe(4);

  // Save + reopen project
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  const projectPath = await saved.path();
  await page.click('#btn-new');
  expect((await els(page)).length).toBe(0);
  await page.setInputFiles('#file-project', projectPath!);
  await expect(page.locator('#pg-label')).toHaveText('Page 1 / 3');
  expect((await els(page)).map((x) => x.type).sort()).toEqual(['arrow', 'cloud', 'free', 'stamp', 'text']);
  await expect(page.locator('#pdf-canvas')).toHaveAttribute('data-rendered', '0');
  info.annotations.push({ type: 'export-bytes', description: String(bytes.length) });
  copyFileSync(out!, 'test-results/annotated-sample.pdf');
});

test('autosave restores the session after a reload', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="switch"]').click();
  await click(page, 300, 300);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored');
  expect((await els(page)).filter((x) => x.type === 'symbol')).toHaveLength(1);
});

test('exports PNG and SVG of a diagram page', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="server"]').click();
  await click(page, 300, 300);
  await page.click('#btn-export');
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#exp-png')]);
  expect(readFileSync((await png.path())!).subarray(1, 4).toString()).toBe('PNG');
  await page.click('#btn-export');
  const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#exp-svg')]);
  expect(readFileSync((await svg.path())!, 'utf8')).toContain('<svg');
});

test('stays responsive with a few hundred shapes', async ({ page }) => {
  await page.click('#btn-new');
  await page.evaluate(() => {
    const s = (window as any).__handsketch.state;
    const els = [] as any[];
    for (let i = 0; i < 300; i++) {
      els.push({ id: 'x' + i, seed: i + 1, type: 'symbol', symbol: ['router', 'switch', 'duplex-outlet', 'cctv-dome'][i % 4], x: (i % 20) * 55, y: Math.floor(i / 20) * 50, size: 44, rot: 0, style: { stroke: '#1f2a44', fill: '#f2c94c', fillStyle: 'none', width: 2, roughness: 1 } });
    }
    s.doc.pages[0].elements = els;
  });
  const t = await page.evaluate(async () => {
    const t0 = performance.now();
    await (window as any).__handsketch.rasterize();
    return performance.now() - t0;
  });
  expect(t).toBeLessThan(4000);
});

test('deleting a symbol leaves its connector where it was drawn', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="router"]').click();
  await click(page, 200, 200);
  await page.locator('.sym[data-symbol="switch"]').click();
  await click(page, 500, 200);
  await page.keyboard.press('Escape');
  const [a, b] = (await els(page)).filter((x) => x.type === 'symbol');
  await page.keyboard.press('l');
  await dragTo(page, a.x + a.size * (44 / 48), a.y + a.size / 2, b.x + b.size * (4 / 48), b.y + b.size / 2);
  // move the target a bit first, so the connector's stored p2 is stale
  await page.keyboard.press('v');
  await dragTo(page, b.x + b.size / 2, b.y + b.size / 2, b.x + b.size / 2, b.y + b.size / 2 + 90);
  const moved = (await els(page)).find((x) => x.id === b.id)!;
  await click(page, moved.x + moved.size / 2, moved.y + moved.size / 2);
  await page.keyboard.press('Delete');
  const wire = (await els(page)).find((x) => x.type === 'line')!;
  expect(wire.to).toBeUndefined();
  // frozen at the symbol's last port position (y was shifted by ~90), not its creation point
  expect(wire.p2.y).toBeGreaterThan(b.y + b.size / 2 + 60);
});

test('Escape cancels a drag and restores the original position', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="server"]').click();
  await click(page, 300, 300);
  await page.keyboard.press('Escape');
  const s0 = (await els(page)).find((x) => x.type === 'symbol')!;
  const a = await at(page, s0.x + s0.size / 2, s0.y + s0.size / 2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 120, a.y + 60, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const s1 = (await els(page)).find((x) => x.type === 'symbol')!;
  expect(s1.x).toBe(s0.x);
  expect(s1.y).toBe(s0.y);
  await expect(page.locator('#btn-undo')).toBeEnabled(); // placement is still undoable...
  await page.keyboard.press('Control+z');
  expect(await els(page)).toHaveLength(0); // ...and the cancelled drag added no extra undo step
});

test('rejects a malformed project file without touching the open document', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="router"]').click();
  await click(page, 300, 300);
  const evil = JSON.stringify({
    app: 'handsketch', version: 1,
    doc: { pages: [{ id: 'p', kind: 'blank', width: 600, height: 400, elements: [{ id: 'c', seed: 1, type: 'cloud', x: 0, y: 0, w: 1e9, h: 1e9, style: { stroke: '#000', fill: '#fff', fillStyle: 'hachure', width: 2, roughness: 1 } }] }] },
  });
  await page.setInputFiles('#file-project', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(evil) });
  await expect(page.locator('#status')).toContainText('invalid page');
  expect((await els(page)).filter((x) => x.type === 'symbol')).toHaveLength(1);
});

test('restores a PDF session (including the PDF itself) after reload', async ({ page }) => {
  await page.setInputFiles('#file-pdf', { name: 'plans.pdf', mimeType: 'application/pdf', buffer: await fixturePdf() });
  await expect(page.locator('#pdf-canvas')).toHaveAttribute('data-rendered', '0');
  await page.keyboard.press('r');
  await dragTo(page, 100, 100, 300, 200);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored');
  await expect(page.locator('#pg-label')).toHaveText('Page 1 / 3');
  await expect(page.locator('#pdf-canvas')).toHaveAttribute('data-rendered', '0');
  expect((await els(page)).filter((x) => x.type === 'rect')).toHaveLength(1);
});

test('a style slider drag is a single undo step', async ({ page }) => {
  await page.click('#btn-new');
  await page.locator('.sym[data-symbol="router"]').click();
  await click(page, 300, 300);
  await page.keyboard.press('v');
  const s = (await els(page)).find((x) => x.type === 'symbol')!;
  await click(page, s.x + s.size / 2, s.y + s.size / 2);
  await page.evaluate(() => {
    const input = document.getElementById('st-width') as HTMLInputElement;
    for (const v of [3, 4, 5, 6, 7]) {
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await els(page)).find((x) => x.type === 'symbol')!.style.width).toBe(7);
  await page.keyboard.press('Control+z');
  expect((await els(page)).find((x) => x.type === 'symbol')!.style.width).toBe(2);
});
