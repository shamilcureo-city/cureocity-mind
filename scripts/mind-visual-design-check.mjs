import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(
  new URL('../services/pdf-generator-service/package.json', import.meta.url),
);
const puppeteer = require('puppeteer');
const base = new URL(process.env.MIND_VISUAL_BASE_URL || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'This fixture check is local-only.');
const output = resolve(
  process.env.MIND_VISUAL_OUTPUT_DIR || `${tmpdir()}/mind-visual-design-check`,
);
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
console.log('Local browser ready');
const page = await browser.newPage();
const errors = [];
const blocked = [];
const requests = [];
const checks = [];
const route = '/dev/mind-visual-design';
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  requests.push({ path: url.pathname, method: request.method(), type: request.resourceType() });
  if (
    url.origin !== base.origin ||
    url.pathname.startsWith('/api/') ||
    (request.isNavigationRequest() && !url.pathname.startsWith(route))
  ) {
    blocked.push({ path: url.pathname, method: request.method(), type: request.resourceType() });
    return request.respond({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Blocked by local-only fixture test.' }),
    });
  }
  if (url.pathname.startsWith('/app') || url.pathname.startsWith('/auth')) {
    blocked.push({ path: url.pathname, method: request.method(), type: 'prefetch' });
    return request.respond({ status: 403, body: 'Local visual fixture only.' });
  }
  return request.continue();
});
page.on('pageerror', (error) => errors.push(error.message));
await page.evaluateOnNewDocument(() => {
  window.__fixtureMediaCalls = 0;
  const deny = async () => {
    window.__fixtureMediaCalls += 1;
    throw new DOMException('Device access is disabled by the visual test.', 'NotAllowedError');
  };
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = deny;
    navigator.mediaDevices.getDisplayMedia = deny;
  }
});

async function clickText(selector, text) {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    if ((await handle.evaluate((element) => element.textContent?.trim())) === text) {
      await handle.click();
      return;
    }
  }
  throw new Error(`Missing ${selector}: ${text}`);
}

try {
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(new URL(route, base).href, { waitUntil: 'networkidle0', timeout: 120000 });
  console.log('Fixture page loaded');
  await page.waitForSelector('[data-preview-view="today"]');
  await page.click('[data-preview-view="today"] a[href="/app/clients/fictional-ananya"]');
  await page.waitForSelector('[data-preview-view="client"]');
  const canonicalPrepare = await page.$(
    '[data-preview-view="client"] a[href*="record=fictional-ananya"]',
  );
  assert(canonicalPrepare, 'Client overview must preserve a canonical preparation route.');
  const prepareHref = await canonicalPrepare.evaluate((anchor) => anchor.getAttribute('href'));
  assert(
    prepareHref.includes('session=fictional-october-visit'),
    'Preparation must retain the booked visit identity.',
  );
  await canonicalPrepare.click();
  await page.waitForSelector('[data-preview-view="prepare"]');
  checks.push({
    connectedNavigation: 'Today → client overview → booked session preparation',
    prepareHref,
  });
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewport({ width, height: width === 1440 ? 1000 : 844, deviceScaleFactor: 1 });
    for (const view of ['today', 'client', 'prepare']) {
      await page.click(`[data-preview-screen="${view}"]`);
      console.log(`Checking ${view} at ${width}px`);
      await page.waitForSelector(`[data-preview-view="${view}"]`);
      if (view === 'prepare') await page.waitForSelector('textarea');
      await page.evaluate(() => document.fonts.ready);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        emptyHeadings: [...document.querySelectorAll('h1,h2,h3')].filter(
          (heading) => !heading.textContent?.trim(),
        ).length,
      }));
      assert(
        dimensions.scroll <= width + 1 && dimensions.body <= width + 1,
        `${view} overflows at ${width}px: ${JSON.stringify(dimensions)}`,
      );
      assert.equal(dimensions.emptyHeadings, 0);
      await page.screenshot({ path: `${output}/${view}-${width}.png`, fullPage: true });
      checks.push({ screen: view, width, horizontalOverflow: false });
    }
  }

  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.click('[data-preview-screen="prepare"]');
  await page.waitForSelector('textarea');
  await clickText('label', 'Write my own note').catch(async () => {
    const input = await page.$('input[name="documentation"]');
    if (!input) return;
    const labels = await page.$$('label');
    for (const label of labels) {
      if ((await label.evaluate((node) => node.textContent)).includes('Write my own note')) {
        await label.click();
        break;
      }
    }
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.trim() === 'Start without recording' && !button.disabled,
    ),
  );
  await page.type('textarea', 'Explore what felt useful about the pause before meetings.');
  await page.waitForFunction(() => document.body.textContent.includes('unsaved'));
  const dirtyGuard = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.disabled && /Start|Open.*note/i.test(button.textContent || ''),
    ),
  );
  assert(dirtyGuard, 'Starting must remain blocked with dirty preparation.');
  await clickText('button', 'Use for this visit');
  const pendingGuard = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.disabled && /Start|Open.*note/i.test(button.textContent || ''),
    ),
  );
  assert(pendingGuard, 'Starting must remain blocked while a focus acknowledgement is pending.');
  await page.waitForFunction(
    () =>
      document.body.textContent.includes('Preparation saved') ||
      document.body.textContent.includes('Saved for this visit'),
    { timeout: 10000 },
  );
  checks.push({
    dirtyPreparationStartBlocked: dirtyGuard,
    pendingPreparationStartBlocked: pendingGuard,
    memoryOnlySaveAcknowledged: true,
  });

  const deviceCalls = await page.evaluate(
    () => (window.__fixtureMediaCalls || 0) + (window.__mindVisualMediaCalls || 0),
  );
  assert.equal(deviceCalls, 0, 'The test must not request audio or display capture.');
  const stored = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  assert.deepEqual(stored, { local: 0, session: 0 });
  const actualApiRequests = requests.filter((request) => request.path.startsWith('/api/'));
  assert.deepEqual(
    actualApiRequests,
    [],
    'All component API calls must be intercepted inside the fixture.',
  );
  assert.deepEqual(errors, [], 'Browser runtime errors');
  checks.push({
    deviceCalls,
    browserStorage: stored,
    realApiRequests: actualApiRequests.length,
    runtimeErrors: errors.length,
  });
  const report = {
    passed: true,
    localOnly: true,
    checkedAt: new Date().toISOString(),
    browser: await browser.version(),
    checks,
    blocked,
    limitations: [
      'Fictional data, not authenticated production or clinical validation.',
      'No real microphone, AI call, database mutation, signing or deployment was exercised.',
      'Full accessibility audit, device permission states and cross-browser verification are separate.',
    ],
  };
  await writeFile(`${output}/validation.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, output }, null, 2));
} finally {
  await browser.close();
}
