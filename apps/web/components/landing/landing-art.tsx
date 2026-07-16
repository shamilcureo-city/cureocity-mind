/**
 * Landing v9.3 — the large static illustrations, embedded verbatim from the
 * approved design mockup (journey timeline, outcomes chart, Mumbai residency
 * pin, the therapy-room line drawing, and a few small sparklines). Raw SVG
 * via dangerouslySetInnerHTML keeps them pixel-identical to the approved
 * artwork; every string below is static, author-controlled content.
 */

function Art({ svg }: { svg: string }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const TIMELINE = `<svg viewBox="0 0 720 176" class="ba-tl" role="img" aria-label="A client's sixteen-week arc: eight sessions, PHQ-9 falling 18 to 7, diagnosis confirmed, plan updated">
        <rect x="26" y="12" width="672" height="118" rx="9" fill="#1F41A3" opacity=".045"/>
        <line x1="26" y1="106" x2="698" y2="106" stroke="#172B74" stroke-width="1" stroke-dasharray="4 5" opacity=".45"/>
        <text x="694" y="118" text-anchor="end" font-size="8.5" fill="#172B74" opacity=".8" font-family="IBM Plex Mono,monospace">remission ≤ 4</text>
        <g font-size="9.5" fill="#717886" font-family="IBM Plex Mono,monospace">
          <text x="40" y="164">MAR</text><text x="210" y="164">APR</text><text x="380" y="164">MAY</text><text x="540" y="164">JUN</text><text x="668" y="164">JUL</text>
        </g>
        <line x1="26" y1="148" x2="698" y2="148" stroke="var(--line)" stroke-width="1"/>
        <polygon points="52,34 144,44 236,54 328,72 420,88 512,96 604,102 604,130 52,130" fill="#172B74" opacity=".05"/>
        <path d="M52 34 L144 44 L236 54 L328 72 L420 88 L512 96 L604 102" fill="none" stroke="#172B74" stroke-width="2.2" stroke-linecap="round"/>
        <g fill="#fff" stroke="#172B74" stroke-width="1.7">
          <circle cx="52" cy="34" r="3.4"/><circle cx="144" cy="44" r="3.4"/><circle cx="236" cy="54" r="3.4"/><circle cx="328" cy="72" r="3.4"/><circle cx="420" cy="88" r="3.4"/><circle cx="512" cy="96" r="3.4"/><circle cx="604" cy="102" r="4" fill="#172B74"/>
        </g>
        <g font-family="IBM Plex Mono,monospace" font-size="9" font-weight="600">
          <text x="44" y="24" fill="#404756">18</text><text x="598" y="93" fill="#172B74">7</text>
        </g>
        <g>
          <rect x="46" y="140" width="11" height="11" rx="3" fill="#B06032"/>
          <circle cx="144" cy="146" r="4.6" fill="#172B74"/><circle cx="236" cy="146" r="4.6" fill="#172B74"/><circle cx="328" cy="146" r="4.6" fill="#172B74"/><circle cx="420" cy="146" r="4.6" fill="#172B74"/><circle cx="512" cy="146" r="4.6" fill="#172B74"/>
          <rect x="598" y="140" width="11" height="11" rx="5.5" fill="none" stroke="#172B74" stroke-width="1.8"/>
          <circle cx="668" cy="146" r="4.6" fill="none" stroke="#717886" stroke-width="1.4" stroke-dasharray="2.5 2.5"/>
          <text x="682" y="136" font-size="8.5" fill="#717886" font-family="IBM Plex Mono,monospace">next</text>
        </g>
        <g>
          <line x1="144" y1="56" x2="144" y2="140" stroke="#2F416B" stroke-width="1" opacity=".45"/>
          <rect x="150" y="60" width="122" height="18" rx="5" fill="#EAEEF4" stroke="#CBD6E5"/>
          <text x="158" y="73" font-size="9.5" fill="#2F416B" font-family="IBM Plex Mono,monospace">6B00 confirmed · S2</text>
          <line x1="328" y1="84" x2="328" y2="140" stroke="#2F416B" stroke-width="1" opacity=".45"/>
          <rect x="334" y="88" width="92" height="18" rx="5" fill="#EAEEF4" stroke="#CBD6E5"/>
          <text x="342" y="101" font-size="9.5" fill="#2F416B" font-family="IBM Plex Mono,monospace">Plan v2 · S4</text>
        </g>
      </svg>`;

const MEASURES_SPARK = `<svg viewBox="0 0 250 58" style="margin-top:8px;">
          <rect x="0" y="0" width="250" height="16" fill="#B06032" opacity=".06"/>
          <rect x="0" y="16" width="250" height="14" fill="#8A7434" opacity=".06"/>
          <rect x="0" y="30" width="250" height="28" fill="#172B74" opacity=".07"/>
          <line x1="0" y1="42" x2="250" y2="42" stroke="#172B74" stroke-dasharray="3 4" stroke-width="1" opacity=".5"/>
          <path d="M10 8 L48 13 L86 18 L124 26 L162 33 L200 37 L238 39" fill="none" stroke="#172B74" stroke-width="2" stroke-linecap="round"/>
          <circle cx="238" cy="39" r="3.2" fill="#172B74"/>
        </svg>`;

const OUTCOMES_CHART = `<svg viewBox="0 0 340 172" style="width:100%;margin-top:14px;" role="img" aria-label="PHQ-9 falling from 18 to 4 over eight sessions into remission">
          <rect x="0" y="6" width="340" height="30" fill="#B3402F" opacity=".05"/>
          <rect x="0" y="36" width="340" height="30" fill="#2563EB" opacity=".05"/>
          <rect x="0" y="66" width="340" height="30" fill="#2F416B" opacity=".06"/>
          <rect x="0" y="96" width="340" height="28" fill="#172B74" opacity=".05"/>
          <rect x="0" y="124" width="340" height="42" fill="#172B74" opacity=".1"/>
          <text x="336" y="18" text-anchor="end" font-size="8.5" fill="#B3402F" opacity=".6">severe</text>
          <text x="336" y="48" text-anchor="end" font-size="8.5" fill="#2563EB" opacity=".65">mod-severe</text>
          <text x="336" y="78" text-anchor="end" font-size="8.5" fill="#2F416B" opacity=".7">moderate</text>
          <text x="336" y="108" text-anchor="end" font-size="8.5" fill="#172B74" opacity=".7">mild</text>
          <text x="6" y="137" font-size="8.5" fill="#172B74" opacity=".85">remission ≤ 4</text>
          <line x1="0" y1="124" x2="340" y2="124" stroke="#172B74" stroke-width="1.2" stroke-dasharray="5 5" opacity=".5"/>
          <polygon points="18,26 60,38 102,46 144,70 186,94 228,106 270,120 312,134 312,166 18,166" fill="#1F41A3" opacity=".07"/>
          <path class="outspark" d="M18 26 L60 38 L102 46 L144 70 L186 94 L228 106 L270 120 L312 134" fill="none" stroke="#172B74" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
          <g fill="#fff" stroke="#172B74" stroke-width="2">
            <circle cx="18" cy="26" r="4"/><circle cx="60" cy="38" r="3.4"/><circle cx="102" cy="46" r="3.4"/><circle cx="144" cy="70" r="3.4"/><circle cx="186" cy="94" r="3.4"/><circle cx="228" cy="106" r="3.4"/><circle cx="270" cy="120" r="3.4"/><circle cx="312" cy="134" r="4.6" fill="#172B74"/>
          </g>
          <text x="12" y="15" font-size="10.5" font-weight="600" fill="#404756" font-family="IBM Plex Mono,monospace">18</text>
          <text x="306" y="152" font-size="10.5" font-weight="600" fill="#172B74" font-family="IBM Plex Mono,monospace">4</text>
        </svg>`;

const RESIDENCY_PIN = `<svg viewBox="0 0 260 200" class="india" aria-label="Session audio processed in the Mumbai cloud region, then deleted on schedule">
          <defs>
            <radialGradient id="rgl" cx="50%" cy="50%"><stop offset="0%" stop-color="#1F41A3" stop-opacity=".18"/><stop offset="100%" stop-color="#1F41A3" stop-opacity="0"/></radialGradient>
          </defs>
          <circle cx="130" cy="92" r="86" fill="url(#rgl)"/>
          <circle cx="130" cy="92" r="70" fill="none" stroke="#1F41A3" stroke-width="1" stroke-dasharray="2 5" opacity=".55"/>
          <circle cx="130" cy="92" r="48" fill="none" stroke="#1F41A3" stroke-width="1" stroke-dasharray="2 5" opacity=".75"/>
          <circle cx="130" cy="92" r="26" fill="#EAF0F7" stroke="#1F41A3" stroke-width="1.4"/>
          <path d="M130 78c-7.6 0-13.5 5.9-13.5 13.2 0 9.4 13.5 22.3 13.5 22.3s13.5-12.9 13.5-22.3C143.5 83.9 137.6 78 130 78Zm0 18.4a5.2 5.2 0 1 1 0-10.4 5.2 5.2 0 0 1 0 10.4Z" fill="#172B74"/>
          <circle cx="130" cy="92" r="26" fill="#172B74" opacity=".28" style="animation:pulse-ring 2.4s ease-out infinite;transform-origin:130px 92px;"/>
          <g font-family="Inter,system-ui" text-anchor="middle">
            <text x="130" y="146" font-size="12.5" font-weight="700" fill="#0C1A4A">Mumbai</text>
            <text x="130" y="161" font-size="9.5" fill="#717886" font-family="IBM Plex Mono,monospace">asia-south1 · Vertex AI</text>
          </g>
          <g font-size="9" fill="#404756" font-family="Inter,system-ui">
            <rect x="6" y="24" width="88" height="22" rx="11" fill="#fff" stroke="#E2E7ED"/><text x="50" y="38.5" text-anchor="middle">🎙 your room</text>
            <rect x="168" y="24" width="86" height="22" rx="11" fill="#fff" stroke="#E2E7ED"/><text x="211" y="38.5" text-anchor="middle">🗑 30-day purge</text>
          </g>
          <path d="M62 46 C80 62 96 74 106 82" fill="none" stroke="#1F41A3" stroke-width="1.4" stroke-dasharray="4 4" opacity=".7"/>
          <path d="M154 82 C166 72 184 60 200 46" fill="none" stroke="#1F41A3" stroke-width="1.4" stroke-dasharray="4 4" opacity=".7"/>
        </svg>`;

const ROOM = `<svg class="room rv" viewBox="0 0 560 250" role="img" aria-label="Line drawing of a therapy room: two armchairs facing each other, a small table with a plant, a floor lamp">
      <g fill="none" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <!-- rug -->
        <ellipse cx="280" cy="216" rx="200" ry="18" opacity=".35" stroke-dasharray="1 7"/>
        <!-- left armchair (facing right) -->
        <path d="M96 196 v-58 q0 -14 14 -14 h44 q12 0 12 12 v34"/>
        <path d="M96 138 q-16 2 -16 18 v28 q0 12 12 12 h74 q10 0 10 -10 v-22 q0 -12 -12 -12"/>
        <path d="M104 196 v12 M158 196 v12"/>
        <!-- cushion -->
        <path d="M112 158 q18 -8 40 0" opacity=".6"/>
        <!-- right armchair (facing left) -->
        <path d="M464 196 v-58 q0 -14 -14 -14 h-44 q-12 0 -12 12 v34"/>
        <path d="M464 138 q16 2 16 18 v28 q0 12 -12 12 h-74 q-10 0 -10 -10 v-22 q0 -12 12 -12"/>
        <path d="M456 196 v12 M402 196 v12"/>
        <path d="M448 158 q-18 -8 -40 0" opacity=".6"/>
        <!-- side table -->
        <line x1="252" y1="170" x2="308" y2="170"/>
        <line x1="280" y1="170" x2="280" y2="208"/>
        <path d="M264 208 h32" opacity=".7"/>
        <!-- plant on table -->
        <path d="M272 170 v-10 q0 -6 8 -6 t8 6 v10" opacity="0"/>
        <path d="M273 170 q-1 -12 7 -20 M280 170 q0 -16 0 -24 M287 170 q1 -12 -7 -20"/>
        <path d="M280 146 q-6 -6 -4 -14 M280 146 q6 -6 4 -14" opacity=".8"/>
        <!-- floor lamp, right -->
        <line x1="524" y1="212" x2="524" y2="106"/>
        <path d="M524 106 q0 -10 -12 -10 h-4"/>
        <path d="M496 96 h24 l-5 18 h-14 z"/>
        <path d="M510 212 h28" opacity=".7"/>
        <!-- window hint, left -->
        <rect x="24" y="70" width="54" height="70" rx="3" opacity=".4"/>
        <line x1="51" y1="70" x2="51" y2="140" opacity=".4"/>
        <line x1="24" y1="105" x2="78" y2="105" opacity=".4"/>
        <!-- voice-line between the chairs -->
        <path d="M204 96 q6 -7 12 0 t12 0 6 -5 6 5 12 0 12 0 6 -8 6 8 12 0 12 0 6 -4 6 4 12 0 12 0 6 -6 6 6 12 0" opacity=".8" stroke-width="1.5"/>
      </g>
    </svg>`;

const HOW_PATH = `<svg class="how-path" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
      <path class="how-dash" d="M60 30 C 240 -14, 420 74, 560 30 S 860 -8, 950 34" fill="none" stroke="var(--brand)" stroke-width="2" stroke-dasharray="7 8" opacity=".4"/>
    </svg>`;

const FC_SPARK = `<svg viewBox="0 0 210 46" style="margin-top:8px;">
        <line x1="0" y1="36" x2="210" y2="36" stroke="#1F41A3" stroke-dasharray="3 4" stroke-width="1" opacity=".5"/>
        <path d="M8 8 L42 13 L76 17 L110 24 L144 29 L178 32 L202 33" fill="none" stroke="#172B74" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="202" cy="33" r="3.6" fill="#172B74"/>
      </svg>`;

const BREATH_SIG = `<svg class="breath-sig" viewBox="0 0 220 26" aria-hidden="true"><path d="M4 13 C20 13 22 5 36 5 S 58 21 72 21 94 6 108 6 130 19 144 19 166 9 180 9 208 13 216 13" fill="none" stroke="#1F41A3" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`;

const LANG_ARROW = `<svg viewBox="0 0 40 40"><path d="M6 20h26M26 13l7 7-7 7" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function TimelineArt() {
  return <Art svg={TIMELINE} />;
}

export function MeasuresSparkArt() {
  return <Art svg={MEASURES_SPARK} />;
}

export function OutcomesChartArt() {
  return <Art svg={OUTCOMES_CHART} />;
}

export function ResidencyPinArt() {
  return <Art svg={RESIDENCY_PIN} />;
}

export function RoomArt() {
  return <Art svg={ROOM} />;
}

export function HowPathArt() {
  return <Art svg={HOW_PATH} />;
}

export function FcSparkArt() {
  return <Art svg={FC_SPARK} />;
}

export function BreathSigArt() {
  return <Art svg={BREATH_SIG} />;
}

export function LangArrowArt() {
  return <Art svg={LANG_ARROW} />;
}
