'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ConceptCategory,
  ConceptNode,
  ConceptualMapResponse,
  ConceptualMapV1,
} from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface Props {
  clientId: string;
}

const CATEGORY_COLOR: Record<ConceptCategory, string> = {
  VALUE: '#f4c95d', // yellow
  AFFIRMATION: '#7fbf83', // green
  CHALLENGE: '#e07b75', // red
  PATTERN: '#5ab1c9', // blue
  BELIEF: '#5ebaa7', // teal
};

const CATEGORY_LABEL: Record<ConceptCategory, string> = {
  VALUE: 'Value',
  AFFIRMATION: 'Affirmation',
  CHALLENGE: 'Challenge',
  PATTERN: 'Pattern',
  BELIEF: 'Belief',
};

const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 620;

/**
 * Sprint 24 — Klarify-style conceptual map view.
 *
 * Renders the persisted ConceptualMapV1 as a force-laid-out SVG graph:
 * coloured circles by category, edges between connected concepts, click
 * any node for a quote + summary + connections + reflection prompts
 * modal. Refresh button kicks Pass 7 (POST /conceptual-map).
 *
 * Force layout is hand-rolled (50 iterations of spring + repulsion + a
 * mild centre-pull) so we don't take a dep on @xyflow/react. SVG output
 * means it composes cleanly with our existing design tokens.
 */
export function ConceptualMapTab({ clientId }: Props) {
  const [data, setData] = useState<ConceptualMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/clients/${clientId}/conceptual-map`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Could not load conceptual map (${res.status})`);
        const payload = (await res.json()) as ConceptualMapResponse;
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/conceptual-map`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Generation failed (${res.status})`);
      }
      const payload = (await res.json()) as ConceptualMapResponse;
      setData(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-7">
        <p className="text-sm text-[var(--color-ink-3)]">Loading conceptual map…</p>
      </Card>
    );
  }

  if (!data?.map || data.map.nodes.length === 0) {
    return (
      <Card className="p-10 text-center">
        <h2 className="font-serif text-2xl">Conceptual map</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          {data?.generatedAt
            ? 'Last refresh produced no nodes — there might not be enough transcript yet.'
            : 'A graph of the values, beliefs, patterns and challenges that have surfaced across this client’s sessions. Once you’ve recorded at least one session, you can generate it here.'}
        </p>
        {error && <p className="mt-3 text-xs text-[var(--color-warn)]">{error}</p>}
        <div className="mt-5">
          <Button onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Generating…' : 'Generate map'}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-7">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Conceptual map</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {data.map.nodes.length} concepts · {data.map.edges.length} connections · last refresh{' '}
            {data.generatedAt ? formatRelative(data.generatedAt) : 'unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CategoryLegend />
          <Button onClick={refresh} disabled={refreshing} variant="secondary">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>
      {error && <p className="mb-3 text-xs text-[var(--color-warn)]">{error}</p>}

      <Graph map={data.map} onSelect={setSelectedNodeId} />

      {selectedNodeId && (
        <NodeDetailModal
          map={data.map}
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </Card>
  );
}

function CategoryLegend() {
  return (
    <div className="hidden flex-wrap items-center gap-2 sm:flex">
      {(Object.keys(CATEGORY_COLOR) as ConceptCategory[]).map((cat) => (
        <span
          key={cat}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]"
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: CATEGORY_COLOR[cat] }}
          />
          {CATEGORY_LABEL[cat]}
        </span>
      ))}
    </div>
  );
}

interface Position {
  x: number;
  y: number;
}

function Graph({ map, onSelect }: { map: ConceptualMapV1; onSelect: (nodeId: string) => void }) {
  // Memoise the layout so re-renders (selection) don't re-simulate.
  const positions = useMemo(() => layoutGraph(map), [map]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]">
      <svg
        viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Client conceptual map"
        style={{ minHeight: 480 }}
      >
        {map.edges.map((e, i) => {
          const a = positions[e.from];
          const b = positions[e.to];
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-line)"
              strokeWidth={1.2}
            />
          );
        })}
        {map.nodes.map((node) => {
          const p = positions[node.id];
          if (!p) return null;
          return (
            <NodeCircle
              key={node.id}
              node={node}
              x={p.x}
              y={p.y}
              onClick={() => onSelect(node.id)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function NodeCircle({
  node,
  x,
  y,
  onClick,
}: {
  node: ConceptNode;
  x: number;
  y: number;
  onClick: () => void;
}) {
  const radius = labelRadius(node.label);
  const lines = wrapLabel(node.label, radius);
  const fill = CATEGORY_COLOR[node.category];
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={onClick}
      role="button"
      aria-label={`${CATEGORY_LABEL[node.category]}: ${node.label}`}
    >
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fill}
        stroke="white"
        strokeWidth={2.5}
        style={{ filter: 'drop-shadow(0 4px 14px rgba(15,27,42,0.10))' }}
      />
      <text
        x={x}
        y={y - ((lines.length - 1) * 12) / 2}
        textAnchor="middle"
        style={{ fontSize: 11, fontWeight: 600, fill: '#1d2733', pointerEvents: 'none' }}
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 4 : 13}>
            {ln}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function NodeDetailModal({
  map,
  nodeId,
  onClose,
}: {
  map: ConceptualMapV1;
  nodeId: string;
  onClose: () => void;
}) {
  const node = map.nodes.find((n) => n.id === nodeId);
  const [tab, setTab] = useState<'details' | 'reflections'>('details');
  if (!node) return null;
  const connectedEdges = map.edges
    .filter((e) => e.from === nodeId || e.to === nodeId)
    .map((e) => ({
      otherId: e.from === nodeId ? e.to : e.from,
      relationship: e.relationship,
    }))
    .map((c) => ({
      ...c,
      otherNode: map.nodes.find((n) => n.id === c.otherId) ?? null,
    }))
    .filter((c) => c.otherNode !== null);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,27,42,0.45)] p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: CATEGORY_COLOR[node.category] }}
            />
            <h3 className="font-serif text-2xl">{node.label}</h3>
            <Badge tone="muted">{CATEGORY_LABEL[node.category]}</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setTab('details')}
              className={`font-medium ${
                tab === 'details'
                  ? 'text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
              }`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setTab('reflections')}
              className={`font-medium ${
                tab === 'reflections'
                  ? 'text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
              }`}
            >
              Reflections
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-[var(--color-ink-3)] hover:bg-[var(--color-surface-soft)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 6l12 12M18 6 6 18" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {tab === 'details' ? (
          <div className="space-y-5">
            <section>
              <h4 className="text-sm font-semibold">Supporting quote</h4>
              <blockquote className="mt-1.5 border-l-2 border-[var(--color-accent)] pl-3 italic text-[var(--color-ink-2)]">
                &ldquo;{node.supportingQuote}&rdquo;
              </blockquote>
            </section>
            <section>
              <h4 className="text-sm font-semibold">Summary</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink)]">
                {node.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="text-sm font-semibold">Description</h4>
              <p className="mt-1.5 text-sm text-[var(--color-ink)]">{node.description}</p>
            </section>
            {connectedEdges.length > 0 && (
              <section>
                <h4 className="text-sm font-semibold">Connections</h4>
                <ul className="mt-1.5 space-y-1.5 text-sm text-[var(--color-ink)]">
                  {connectedEdges.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.otherNode?.label}:</span>{' '}
                      <span className="text-[var(--color-ink-2)]">{c.relationship}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : (
          <div>
            {node.reflectionPrompts.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-3)]">
                No reflection prompts generated for this concept.
              </p>
            ) : (
              <ul className="space-y-3 text-sm text-[var(--color-ink)]">
                {node.reflectionPrompts.map((q, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-[var(--color-ink-3)]">
              Send these to the client via the patient portal from the Reflection Questions panel.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Force layout — runs once per map; bounded iterations + viewport clamping.
// ===========================================================================

function layoutGraph(map: ConceptualMapV1): Record<string, Position> {
  const n = map.nodes.length;
  if (n === 0) return {};

  // Initial ring placement.
  const cx = VIEWPORT_WIDTH / 2;
  const cy = VIEWPORT_HEIGHT / 2;
  const ringR = Math.min(cx, cy) * 0.55;
  const positions = new Map<string, Position>();
  map.nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, {
      x: cx + ringR * Math.cos(angle),
      y: cy + ringR * Math.sin(angle),
    });
  });

  const adj = new Map<string, Set<string>>();
  for (const e of map.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }

  const REPULSION = 22000;
  const SPRING = 0.012;
  const SPRING_REST = 180;
  const CENTRE_PULL = 0.0035;
  const DAMP = 0.86;
  const ITERS = 220;

  const vel = new Map<string, Position>();
  for (const node of map.nodes) vel.set(node.id, { x: 0, y: 0 });

  for (let it = 0; it < ITERS; it++) {
    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      const a = map.nodes[i]!;
      const pa = positions.get(a.id)!;
      const va = vel.get(a.id)!;
      for (let j = i + 1; j < n; j++) {
        const b = map.nodes[j]!;
        const pb = positions.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          d2 = dx * dx + dy * dy + 1;
        }
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (f * dx) / d;
        const fy = (f * dy) / d;
        va.x += fx;
        va.y += fy;
        const vb = vel.get(b.id)!;
        vb.x -= fx;
        vb.y -= fy;
      }
    }
    // Edge spring attraction.
    for (const e of map.edges) {
      const pa = positions.get(e.from);
      const pb = positions.get(e.to);
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = SPRING * (d - SPRING_REST);
      const fx = (force * dx) / d;
      const fy = (force * dy) / d;
      const va = vel.get(e.from)!;
      const vb = vel.get(e.to)!;
      va.x -= fx;
      va.y -= fy;
      vb.x += fx;
      vb.y += fy;
    }
    // Centre pull + damping + position update.
    for (const node of map.nodes) {
      const p = positions.get(node.id)!;
      const v = vel.get(node.id)!;
      v.x -= (p.x - cx) * CENTRE_PULL;
      v.y -= (p.y - cy) * CENTRE_PULL;
      v.x *= DAMP;
      v.y *= DAMP;
      p.x += v.x;
      p.y += v.y;
    }
  }

  // Clamp to viewport with a margin matching the largest node radius.
  const margin = 70;
  const out: Record<string, Position> = {};
  for (const node of map.nodes) {
    const p = positions.get(node.id)!;
    out[node.id] = {
      x: clamp(p.x, margin, VIEWPORT_WIDTH - margin),
      y: clamp(p.y, margin, VIEWPORT_HEIGHT - margin),
    };
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function labelRadius(label: string): number {
  // 36–56 px range based on label length so the text fits inside.
  const len = label.length;
  if (len <= 10) return 38;
  if (len <= 18) return 44;
  if (len <= 28) return 50;
  return 56;
}

function wrapLabel(label: string, radius: number): string[] {
  const maxPerLine = Math.max(6, Math.floor(radius / 4));
  if (label.length <= maxPerLine) return [label];
  // Wrap on word boundaries, max 3 lines.
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
      continue;
    }
    if ((current + ' ' + w).length > maxPerLine) {
      lines.push(current);
      current = w;
      if (lines.length === 2) break;
    } else {
      current += ' ' + w;
    }
  }
  if (current && lines.length < 3) lines.push(current);
  return lines.slice(0, 3);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diff = Date.now() - then;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.round(diff / min)} min ago`;
  if (diff < day) return `${Math.round(diff / hour)} h ago`;
  const days = Math.round(diff / day);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
}
