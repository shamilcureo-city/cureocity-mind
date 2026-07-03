'use client';

import { useMemo, useState } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface Props {
  note: TherapyNoteV1;
}

// Scoped keyframes for the mindmap: a staggered entrance pop, a gentle idle
// float, a breathing ring on the centre node, a slow spin on the selected
// ring, and a fade-in-up for the detail box + its list items.
const MINDMAP_KEYFRAMES = `
@keyframes mm-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
@keyframes mm-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes mm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mm-ring { 0%, 100% { opacity: .45; transform: scale(1); } 50% { opacity: .9; transform: scale(1.06); } }
@keyframes mm-spin { to { transform: rotate(360deg); } }
@keyframes mm-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  svg[data-mindmap] * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
`;

interface Branch {
  id: string;
  title: string;
  tone: 'subjective' | 'objective' | 'assessment' | 'plan' | 'risk' | 'phase' | 'modality';
  items: string[];
}

/**
 * Read-only visualisation of a TherapyNoteV1 as a radial mindmap.
 * Center node = "Session"; branches fan out for each SOAP section
 * plus risk, phase hints, and CBT/EMDR modality-specific extracts
 * (thought records, target memories, etc).
 *
 * Pure SVG, no D3 — bounded number of branches (≤ 7) so a fixed
 * angular layout produces readable output without dynamic force
 * simulation. Resizes responsively via SVG viewBox.
 */
export function MindmapTab({ note }: Props) {
  const branches = useMemo(() => buildBranches(note), [note]);
  const layout = useMemo(() => computeLayout(branches), [branches]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Hover wins for the highlight; a selected node stays highlighted when the
  // cursor is elsewhere.
  const activeId = hoveredId ?? selectedId;
  const selected = branches.find((b) => b.id === selectedId) ?? null;

  const pick = (id: string) => setSelectedId((prev) => (prev === id ? null : id));
  const enterHover = (id: string) => setHoveredId(id);
  const leaveHover = (id: string) => setHoveredId((h) => (h === id ? null : h));

  return (
    <div className="space-y-6">
      <Card className="p-7">
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Session mindmap</h2>
          <Badge tone="muted">{note.modality}</Badge>
        </header>
        <p className="text-sm text-[var(--color-ink-2)]">
          The signed note as a topic map. Hover a topic to highlight it; click to open its full
          contents below.
        </p>
        <div className="mt-6">
          <svg
            data-mindmap
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="h-auto w-full select-none"
            style={{ overflow: 'visible' }}
            role="img"
            aria-label="Session mindmap — interactive topic map"
          >
            <style>{MINDMAP_KEYFRAMES}</style>

            {layout.edges.map((edge, i) => {
              const b = branches[i]!;
              const on = activeId === b.id;
              return (
                <path
                  key={b.id}
                  d={`M ${layout.cx} ${layout.cy} Q ${(layout.cx + edge.tx) / 2} ${edge.midY} ${edge.tx} ${edge.ty}`}
                  stroke={on ? 'var(--color-accent)' : 'var(--color-line)'}
                  strokeWidth={on ? 2.5 : 1.5}
                  fill="none"
                  style={{
                    transition: 'stroke 200ms ease, stroke-width 200ms ease',
                    animation: `mm-fade 500ms ease-out ${i * 55}ms backwards`,
                  }}
                />
              );
            })}

            {/* Centre node — clicking it closes the open detail box. */}
            <g
              onClick={() => setSelectedId(null)}
              style={{ cursor: selected ? 'pointer' : 'default' }}
            >
              <circle
                cx={layout.cx}
                cy={layout.cy}
                r={48}
                fill="none"
                stroke="var(--color-accent-soft)"
                strokeWidth={2}
                style={{
                  animation: 'mm-ring 3.6s ease-in-out infinite',
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
              <circle cx={layout.cx} cy={layout.cy} r={42} fill="var(--color-ink)" />
              <text
                x={layout.cx}
                y={layout.cy + 5}
                textAnchor="middle"
                className="font-serif"
                style={{ fill: 'white', fontSize: 14, pointerEvents: 'none' }}
              >
                Session
              </text>
            </g>

            {layout.nodes.map((node, i) => {
              const b = branches[i]!;
              const on = activeId === b.id;
              const isSelected = selectedId === b.id;
              return (
                <g
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${b.title} — ${b.items.length} item${b.items.length === 1 ? '' : 's'}. Click to open.`}
                  onClick={() => pick(b.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pick(b.id);
                    }
                  }}
                  onMouseEnter={() => enterHover(b.id)}
                  onMouseLeave={() => leaveHover(b.id)}
                  onFocus={() => enterHover(b.id)}
                  onBlur={() => leaveHover(b.id)}
                  style={{
                    cursor: 'pointer',
                    outline: 'none',
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    animationName: 'mm-pop, mm-float',
                    animationDuration: '460ms, 7000ms',
                    animationTimingFunction: 'cubic-bezier(.2,.85,.25,1), ease-in-out',
                    animationIterationCount: '1, infinite',
                    animationDelay: `${i * 70}ms, ${i * 70 + 700}ms`,
                    animationFillMode: 'backwards, none',
                  }}
                >
                  <g
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                      transform: on ? 'scale(1.09)' : 'scale(1)',
                      transition: 'transform 200ms cubic-bezier(.2,.85,.25,1)',
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.r + 5}
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth={1.5}
                        strokeDasharray="3 5"
                        style={{
                          animation: 'mm-spin 9s linear infinite',
                          transformBox: 'fill-box',
                          transformOrigin: 'center',
                        }}
                      />
                    )}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r}
                      fill={toneColor(node.tone)}
                      stroke={on ? 'var(--color-accent)' : 'var(--color-line)'}
                      strokeWidth={on ? 2.5 : 1}
                      style={{
                        transition: 'stroke 180ms ease, stroke-width 180ms ease, filter 180ms ease',
                        filter: on ? 'drop-shadow(0 6px 14px rgba(15,27,42,.16))' : 'none',
                      }}
                    />
                    <text
                      x={node.x}
                      y={node.y + 4}
                      textAnchor="middle"
                      style={{
                        fontSize: 11,
                        fill: 'var(--color-ink)',
                        fontWeight: on ? 600 : 400,
                        pointerEvents: 'none',
                      }}
                    >
                      {node.title}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </Card>

      {/* Detail box — opens on click; keyed so it re-animates per selection. */}
      {selected ? (
        <MindmapDetail key={selected.id} branch={selected} onClose={() => setSelectedId(null)} />
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-6 py-8 text-center text-sm text-[var(--color-ink-3)]">
          Click any topic in the map above to open its full contents here.
        </div>
      )}
    </div>
  );
}

function MindmapDetail({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  return (
    <Card className="p-6" style={{ animation: 'mm-in 260ms cubic-bezier(.2,.85,.25,1) both' }}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 rounded-full"
            style={{ backgroundColor: toneColor(branch.tone) }}
          />
          <h3 className="font-serif text-xl text-[var(--color-ink)]">{branch.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
        >
          ✕
        </button>
      </header>
      {branch.items.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-3)]">No content for this topic.</p>
      ) : (
        <ul className="space-y-2 text-[15px] leading-relaxed text-[var(--color-ink)]">
          {branch.items.map((it, i) => (
            <li
              key={i}
              className="flex gap-2.5"
              style={{ animation: `mm-in 260ms ease-out ${i * 40}ms both` }}
            >
              <span
                aria-hidden
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: toneColor(branch.tone) }}
              />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function buildBranches(note: TherapyNoteV1): Branch[] {
  const out: Branch[] = [];
  if (note.subjective?.trim()) {
    out.push({
      id: 'subjective',
      title: 'Subjective',
      tone: 'subjective',
      items: splitIntoBullets(note.subjective),
    });
  }
  if (note.objective?.trim()) {
    out.push({
      id: 'objective',
      title: 'Objective',
      tone: 'objective',
      items: splitIntoBullets(note.objective),
    });
  }
  if (note.assessment?.trim()) {
    out.push({
      id: 'assessment',
      title: 'Assessment',
      tone: 'assessment',
      items: splitIntoBullets(note.assessment),
    });
  }
  if (note.plan?.trim()) {
    out.push({
      id: 'plan',
      title: 'Plan',
      tone: 'plan',
      items: splitIntoBullets(note.plan),
    });
  }
  if (note.riskFlags) {
    const items = [
      `Severity: ${note.riskFlags.severity.toUpperCase()}`,
      ...note.riskFlags.indicators,
      ...(note.riskFlags.details ? [note.riskFlags.details] : []),
    ];
    out.push({
      id: 'risk',
      title: 'Risk',
      tone: 'risk',
      items: items.filter(Boolean),
    });
  }
  if (note.phaseHints && note.phaseHints.length > 0) {
    out.push({
      id: 'phase',
      title: 'Phase hints',
      tone: 'phase',
      items: note.phaseHints.map(
        (h) =>
          `${h.phase} (${(h.confidence * 100).toFixed(0)}%)${h.rationale ? ` — ${h.rationale}` : ''}`,
      ),
    });
  }
  if (note.modalitySpecific && Object.keys(note.modalitySpecific).length > 0) {
    const items = flattenModalitySpecific(note.modalitySpecific);
    if (items.length > 0) {
      out.push({
        id: 'modality',
        title: `${note.modality} specifics`,
        tone: 'modality',
        items,
      });
    }
  }
  return out;
}

function splitIntoBullets(text: string): string[] {
  // Prefer existing bullets / numbered lists, otherwise split on sentence
  // boundaries. Cap at 6 items per branch so the panel stays scannable.
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[•\-*\d+.]+\s*/, '').trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 6);
  const sentences = text.match(/[^.!?]+[.!?]/g) ?? [text];
  return sentences.map((s) => s.trim()).slice(0, 6);
}

function flattenModalitySpecific(spec: Record<string, unknown>, depth = 0): string[] {
  if (depth > 2) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.push(`${prettyKey(key)}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const sample = value
        .slice(0, 3)
        .map((v) =>
          typeof v === 'object' && v !== null
            ? Object.values(v).filter(Boolean).slice(0, 2).join(' · ')
            : String(v),
        )
        .filter(Boolean);
      if (sample.length > 0) {
        out.push(`${prettyKey(key)}: ${sample.join('; ')}`);
      }
    } else if (typeof value === 'object') {
      out.push(...flattenModalitySpecific(value as Record<string, unknown>, depth + 1));
    }
  }
  return out.slice(0, 8);
}

function prettyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const TONE_COLORS: Record<Branch['tone'], string> = {
  subjective: '#e8d5b7',
  objective: '#cfd9c8',
  assessment: '#c5cfdc',
  plan: '#d9c5dc',
  risk: '#e8c5c5',
  phase: '#d5dce8',
  modality: '#e8e0c5',
};

function toneColor(tone: Branch['tone']): string {
  return TONE_COLORS[tone];
}

interface LayoutNode {
  x: number;
  y: number;
  r: number;
  title: string;
  tone: Branch['tone'];
}
interface LayoutEdge {
  tx: number;
  ty: number;
  midY: number;
}
interface Layout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

function computeLayout(branches: Branch[]): Layout {
  const width = 800;
  const height = 480;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 180;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const n = Math.max(branches.length, 1);
  branches.forEach((b, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    nodes.push({ x, y, r: 38, title: b.title, tone: b.tone });
    edges.push({ tx: x, ty: y, midY: (cy + y) / 2 });
  });
  return { width, height, cx, cy, nodes, edges };
}
