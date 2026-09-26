import sharp from 'sharp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A generated fictional source for the local review fixture; no uploads or patient data. */
export async function GET() {
  if (
    process.env['NODE_ENV'] !== 'development' ||
    process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'
  )
    return new Response(null, { status: 404 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="540"><rect width="760" height="540" fill="white"/><g fill="#15243a" font-family="Arial,sans-serif"><text x="45" y="65" font-size="25">Fictional laboratory report</text><text x="45" y="105" font-size="18">Ananya Rao (fictional) · 20 September 2026</text><text x="45" y="150" font-size="16">UI TEST FIXTURE — NOT A CLINICAL DOCUMENT</text><path d="M45 180H715" stroke="#ccd3de"/><text x="45" y="225" font-size="19">Test</text><text x="420" y="225" font-size="19">Result</text><text x="570" y="225" font-size="19">Unit</text><text x="45" y="280" font-size="22">Haemoglobin</text><text x="420" y="280" font-size="22">12.4</text><text x="570" y="280" font-size="22">g/dL</text><path d="M45 320H715" stroke="#ccd3de"/><text x="45" y="380" font-size="17">Check the name, value, unit and date against this source.</text><text x="45" y="440" font-size="15">No real patient data or AI processing is used in this preview.</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
