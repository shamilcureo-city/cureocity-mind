/**
 * Edge-label wrapping for the conceptual map — PC6.
 *
 * Pure geometry/text helpers, kept out of the component so they can be tested
 * (the web vitest config only collects `lib/**\/*.spec.ts`).
 */

/** Chip geometry — the wrapper and the renderer must agree on these. */
export const EDGE_LABEL_CHARS_PER_LINE = 34;
export const EDGE_LABEL_MAX_LINES = 2;
export const EDGE_LABEL_LINE_HEIGHT = 12;
/** ≈ advance width of 9px semibold Inter, used to size the chip. */
export const EDGE_LABEL_CHAR_WIDTH = 5.1;
export const EDGE_LABEL_PAD_X = 7;
export const EDGE_LABEL_PAD_Y = 5;

/**
 * Wrap an edge's relationship text to a bounded chip.
 *
 * `ConceptualMapEdge.relationship` allows up to 280 characters and the model
 * genuinely uses that range — it returns whole sentences ("She has learned
 * that 'cancelling plans twice' is a key relapse signature…"), not the short
 * verb the map was designed around. SVG <text> does not wrap, so one of those
 * rendered as a single unbroken line straight across the canvas: through the
 * nodes, and through any other active edge's label.
 *
 * The canvas therefore shows a clipped preview; the click-through detail panel
 * keeps the full text. Breaks are on word boundaries, falling back to a hard
 * cut only when a single word is wider than the chip.
 */
export function wrapEdgeLabel(text: string): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean === '') return [];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  let consumed = 0; // words placed into `lines` or `current`

  for (const w of words) {
    const candidate = current === '' ? w : `${current} ${w}`;
    if (candidate.length <= EDGE_LABEL_CHARS_PER_LINE) {
      current = candidate;
      consumed += 1;
      continue;
    }
    if (lines.length === EDGE_LABEL_MAX_LINES - 1) break; // the last line is full
    if (current !== '') lines.push(current);
    if (w.length > EDGE_LABEL_CHARS_PER_LINE) {
      // A single word wider than the chip: hard-cut rather than overflow.
      current = w.slice(0, EDGE_LABEL_CHARS_PER_LINE);
      consumed += 1;
      break;
    }
    current = w;
    consumed += 1;
  }
  if (current !== '') lines.push(current);

  if (consumed < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length >= EDGE_LABEL_CHARS_PER_LINE
        ? `${last.slice(0, EDGE_LABEL_CHARS_PER_LINE - 1)}…`
        : `${last}…`;
  }
  return lines;
}

/** Chip box for a wrapped label, in SVG user units. */
export function edgeLabelBox(lines: string[]): { width: number; height: number } {
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    width: widest * EDGE_LABEL_CHAR_WIDTH + EDGE_LABEL_PAD_X * 2,
    height: lines.length * EDGE_LABEL_LINE_HEIGHT + EDGE_LABEL_PAD_Y * 2,
  };
}
