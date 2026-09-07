/** Isolated visual/interaction checks with actual app CSS and React components.
 * Fictional data only; all browser requests are intercepted, no app/DB needed.
 * Uses installed dependencies: node scripts/test-mind-note-layout-browser.mjs
 * Screenshots and measurements are written only to a new /private/tmp directory.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, 'apps/web');
const webRequire = createRequire(join(web, 'package.json'));
const serviceRequire = createRequire(join(root, 'services/pdf-generator-service/package.json'));
const { build } = createRequire(serviceRequire.resolve('tsx/package.json'))('esbuild');
const puppeteer = serviceRequire('puppeteer');
const executablePath = await puppeteer.executablePath();
assert.ok(existsSync(executablePath), 'Installed Chromium is required; no download is attempted.');
const screenshots = await mkdtemp('/private/tmp/mind-note-layout-');
const globals = join(web, 'app/globals.css');
const styles = await webRequire('postcss')([
  webRequire('@tailwindcss/postcss')({ base: web }),
  webRequire('autoprefixer')(),
]).process(await readFile(globals, 'utf8'), { from: globals });
const mindStyles = await readFile(join(web, 'app/app/mind-workspace.css'), 'utf8');
const origin = 'https://mind-layout.example.test';
const base = '2026-09-07T10:00:00.000Z';
const original = {
  version: 'V1',
  modality: 'CBT',
  subjective: 'Fictional client describes their week and what they want to discuss today.',
  objective: 'Fictional observations recorded for layout testing only.',
  assessment: 'Fictional assessment text. This is not clinical advice.',
  plan: 'Fictional next steps to review together at a future appointment.',
  linkedEvidence: [],
  phaseHints: [],
  riskFlags: { severity: 'none', indicators: [] },
  modalitySpecific: {},
};
const bundle = await build({
  stdin: {
    resolveDir: web,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { NoteEditor } from './components/app/NoteEditor';
      import { NoteEditingLayout } from './components/app/NoteEditingLayout';
      import { TranscriptTab } from './components/app/TranscriptTab';
      import { Sidebar } from './components/app/Sidebar';
      import { MobileNav } from './components/app/MobileNav';
      import { Card } from './components/ui/Card';
      import { Container } from './components/ui/Container';
      const note = ${JSON.stringify(original)};
      const segments = Array.from({length: 12}, (_, i) => ({ speaker: i % 2 ? 'client' : 'therapist',
        startMs: i * 15000, endMs: (i + 1) * 15000,
        text: i % 2 ? 'This fictional transcript lets us check the editor layout. I would like enough room to read the words while reviewing my notes.' :
          'This is a fictional conversation. What would you like to cover in this session? We can check the note without leaving this page.' }));
      function Demo() {
        return <div className="app-wash mind-workspace-shell relative flex min-h-screen flex-col" data-product="mind">
          <div className="flex flex-1"><Sidebar vertical="THERAPIST" />
          <div id="mind-main-content" className="mind-content flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
            <Container className="py-8">
              <h1 className="mb-3 font-serif text-3xl">Fictional client · Review &amp; Close</h1>
              <p className="mb-5 text-sm">Isolated note editor check — no real client data.</p>
              <Card className="p-7"><h2 className="mb-5 font-serif text-2xl">Review your session note</h2>
                <NoteEditingLayout reference={<TranscriptTab data={{status:'COMPLETED',segments,transcript:null,totalCostInr:'0',backend:null,errorMessage:null}} />}>
                  <NoteEditor note={note} saving={false}
                    recoveryTarget={{sessionId:'fictional-session',kind:'TREATMENT',baseUpdatedAt:'${base}'}}
                    onSave={async (...args) => { window.actions.push({action:'apply',args}); return true; }}
                    onCancel={() => { window.actions.push({action:'close'}); }} />
                </NoteEditingLayout>
              </Card>
              <section className="py-8"><h2 className="font-serif text-2xl">Next steps</h2><p>Fictional closeout content after the note.</p></section>
            </Container>
          </div><MobileNav vertical="THERAPIST" /></div>
        </div>;
      }
      window.actions = [];
      createRoot(document.getElementById('root')).render(<Demo />);
    `,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'isolated-next-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          resolveDir: web,
          loader: 'jsx',
          contents: path.endsWith('/link')
            ? `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`
            : `export const usePathname=()=>'/app/sessions/fictional-session';`,
        }));
      },
    },
  ],
});
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>${styles.css}\n${mindStyles}\n:root{--font-inter:Arial;--font-fraunces:Georgia;--font-plex-mono:monospace}html{scroll-behavior:auto}</style>
</head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
const errors = [];
const unexpectedRequests = [];
const results = [];
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  args: [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
  ],
});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage();
    let revision = 0;
    let recovery = null;
    await page.setViewport({ width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/note') {
        void request.respond({ status: 200, contentType: 'text/html', body: html });
        return;
      }
      if (url.origin === origin && url.pathname.endsWith('/note-edit-recovery')) {
        if (request.method() === 'GET') {
          void request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ revision, recovery, stale: false }),
          });
          return;
        }
        if (request.method() === 'PUT') {
          const packet = JSON.parse(request.postData());
          recovery = {
            fields: packet.fields,
            kind: packet.kind,
            baseUpdatedAt: packet.baseUpdatedAt,
            updatedAt: base,
          };
          void request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ revision: ++revision, updatedAt: base }),
          });
          return;
        }
      }
      unexpectedRequests.push({ url: request.url(), method: request.method() });
      void request.abort();
    });
    await page.goto(`${origin}/note`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('textarea:not(:disabled)'));
    const edited = `Fictional correction at ${width}px: this text must survive reference toggles.`;
    await page.$eval(
      'textarea',
      (field, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      edited,
    );
    const clickButton = async (label) => {
      const button = await page.waitForSelector(`::-p-text(${label})`);
      await button.click();
    };
    await clickButton('Show transcript reference');
    await page.waitForSelector('aside[aria-label="Transcript reference"]');
    const measure = () =>
      page.evaluate(() => {
        const reference = document.querySelector('aside[aria-label="Transcript reference"]');
        const editor = document.querySelector('textarea').closest('.space-y-5');
        const rect = (el) => ({
          x: el.getBoundingClientRect().x,
          y: el.getBoundingClientRect().y,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        });
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          reference: rect(reference),
          editor: rect(editor),
          referenceScrollHeight: reference.lastElementChild.scrollHeight,
          referenceClientHeight: reference.lastElementChild.clientHeight,
        };
      });
    const layout = await measure();
    assert.ok(
      layout.documentWidth <= width + 1,
      `${width}px page overflows: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      layout.reference.x >= 0 && layout.reference.x + layout.reference.width <= width + 1,
      'Reference fits viewport',
    );
    if (width === 390) {
      assert.ok(layout.reference.y < layout.editor.y, 'Mobile reference must stack above editor');
      assert.ok(layout.referenceClientHeight <= 257, 'Mobile transcript has a bounded scroll pane');
    } else {
      assert.ok(
        layout.reference.x > layout.editor.x + layout.editor.width,
        'Desktop reference must sit beside editor',
      );
      assert.ok(Math.abs(layout.reference.y - layout.editor.y) <= 1, 'Desktop columns align');
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, `${width}-reference-top.png`) });
    await clickButton('Hide transcript reference');
    assert.equal(
      await page.$eval('textarea', (field) => field.value),
      edited,
      'Hide reference preserves corrections',
    );
    await clickButton('Show transcript reference');
    assert.equal(
      await page.$eval('textarea', (field) => field.value),
      edited,
      'Show reference preserves corrections',
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes('Draft edits saved securely'),
    );
    await page.evaluate(() => {
      const fields = document.querySelectorAll('textarea');
      fields[fields.length - 1].scrollIntoView({ block: 'center' });
    });
    const controls = await page.evaluate(() =>
      ['Apply corrections', 'Close editor'].map((label) => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === label,
        );
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          label,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          visible: rect.top >= 0 && rect.bottom <= innerHeight && !!hit && button.contains(hit),
          position: getComputedStyle(button.parentElement).position,
        };
      }),
    );
    for (const control of controls) {
      assert.equal(control.position, 'sticky', 'Real Tailwind sticky footer is active');
      assert.ok(
        control.visible,
        `${width}px ${control.label} is obscured: ${JSON.stringify(control)}`,
      );
    }
    await page.screenshot({ path: join(screenshots, `${width}-editor-controls.png`) });
    assert.equal(
      await page.evaluate(() => window.actions.length),
      0,
      'Visual interactions never apply, close or sign',
    );
    results.push({ width, layout, controls });
    await page.close();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(unexpectedRequests, [], 'No unmocked/external requests');
  await writeFile(join(screenshots, 'measurements.json'), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        screenshots,
        results,
        limitations: [
          'Isolated component harness; not authenticated app/server validation',
          'Uses local Arial/Georgia fallbacks, not downloaded next/font assets',
          'No real mobile keyboard, safe-area hardware or touch-device testing',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
