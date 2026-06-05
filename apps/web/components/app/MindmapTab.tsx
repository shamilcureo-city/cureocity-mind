'use client';

import { useMemo } from 'react';
import type { TherapyNoteV1 } from '@cureocity/contracts';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface Props {
  note: TherapyNoteV1;
}

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

  return (
    <div className="space-y-6">
      <Card className="p-7">
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-2xl">Session mindmap</h2>
          <Badge tone="muted">{note.modality}</Badge>
        </header>
        <p className="text-sm text-[var(--color-ink-2)]">
          The signed note rendered as a topic map. Each branch corresponds to a section of the
          TherapyNoteV1; click a node to see its full contents.
        </p>
        <div className="mt-6">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="h-auto w-full"
            role="img"
            aria-label="Session mindmap"
          >
            {layout.edges.map((edge, i) => (
              <path
                key={i}
                d={`M ${layout.cx} ${layout.cy} Q ${(layout.cx + edge.tx) / 2} ${edge.midY} ${edge.tx} ${edge.ty}`}
                stroke="var(--color-line)"
                strokeWidth={1.5}
                fill="none"
              />
            ))}
            <g>
              <circle cx={layout.cx} cy={layout.cy} r={42} fill="var(--color-ink)" />
              <text
                x={layout.cx}
                y={layout.cy + 5}
                textAnchor="middle"
                className="fill-white font-serif text-sm"
                style={{ fill: 'white', fontSize: 14 }}
              >
                Session
              </text>
            </g>
            {layout.nodes.map((node, i) => (
              <g key={i}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={toneColor(node.tone)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  style={{ fontSize: 11, fill: 'var(--color-ink)' }}
                >
                  {node.title}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {branches.map((b) => (
          <Card key={b.id} className="p-6">
            <header className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
                {b.title}
              </h3>
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: toneColor(b.tone) }}
                aria-hidden
              />
            </header>
            {b.items.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-3)]">No content for this branch.</p>
            ) : (
              <ul className="space-y-1.5 text-sm text-[var(--color-ink)]">
                {b.items.map((it, i) => (
                  <li key={i} className="leading-relaxed">
                    {it}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
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
