import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

/**
 * Sprint 24 — Conceptual Map (Pass 7).
 *
 * A per-client, cumulative graph of the themes, values, beliefs,
 * patterns, and challenges that have surfaced across all sessions.
 * Renders as a force-directed graph in the client page; clicking a
 * node opens a quote-anchored detail panel with reflection prompts
 * the therapist can send to the client via the portal.
 *
 * Unlike the per-session SOAP `MindmapTab` (Sprint 6), this is
 * cumulative and conceptual — it abstracts themes from raw transcript
 * material and weaves them together. Closest analogue is Klarify's
 * "Mind map" feature; the categorical colour-coding (value /
 * affirmation / challenge / pattern / belief) matches their UX.
 *
 * Always re-generated on the therapist's "Refresh" — there's no
 * deterministic fallback because thematic abstraction is the whole
 * point. If Pass 7 fails the previous map row stays as the visible
 * map (the UI tells the therapist the refresh failed).
 */

/** Five clinically distinct kinds of node — drives colour + grouping. */
export const ConceptCategorySchema = z.enum([
  'VALUE',
  'AFFIRMATION',
  'CHALLENGE',
  'PATTERN',
  'BELIEF',
]);
export type ConceptCategory = z.infer<typeof ConceptCategorySchema>;

export const ConceptNodeSchema = z.object({
  /** Stable id within the map (`n1`, `n2`, …) — used by edges. */
  id: z.string().min(1).max(12),
  /** 1-4 word label rendered inside the circle. */
  label: z.string().min(1).max(60),
  category: ConceptCategorySchema,
  /**
   * Verbatim line from the session transcript that anchors the node.
   * Must be quoted from the client's own words; lifts the abstraction
   * out of the realm of "AI made this up".
   */
  supportingQuote: z.string().min(1).max(800),
  /** 1-3 short bullets. */
  summary: z.array(z.string().min(1).max(240)).min(1).max(3),
  /** One plain-language sentence. */
  description: z.string().min(1).max(400),
  /**
   * 0-3 reflection questions the therapist could send to the client
   * about this concept (e.g. "When did you first notice this belief?").
   * Reuses the existing Reflection-Question portal share pattern.
   */
  reflectionPrompts: z.array(z.string().min(1).max(280)).max(3),
  /**
   * Session IDs the node was derived from. The LLM is asked to echo
   * back IDs from the input set, but we don't strict-validate them
   * (CUID checks here just brittle the response without buying safety
   * — these IDs are display-only).
   */
  sourceSessionIds: z.array(z.string()).max(50),
});
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;

export const ConceptEdgeSchema = z.object({
  /** Source node id. */
  from: z.string().min(1).max(12),
  /** Target node id. */
  to: z.string().min(1).max(12),
  /**
   * One plain-language sentence explaining the connection. Surfaces
   * in the node-detail panel's Connections section.
   */
  relationship: z.string().min(1).max(280),
});
export type ConceptEdge = z.infer<typeof ConceptEdgeSchema>;

export const ConceptualMapV1Schema = z.object({
  version: z.literal('V1'),
  /** 6-18 nodes — fewer feels thin; more feels noisy. */
  nodes: z.array(ConceptNodeSchema).min(0).max(18),
  /**
   * 0-30 edges. Every edge endpoint must reference a node id from the
   * `nodes` array — enforced by a refinement on the wrapping schema.
   */
  edges: z.array(ConceptEdgeSchema).max(30),
  generatedAt: IsoDateTimeSchema,
  /** Session IDs the prompt actually saw — server-controlled (route fills in). */
  basedOnSessionIds: z.array(z.string()).max(100),
}).superRefine((map, ctx) => {
  const ids = new Set(map.nodes.map((n) => n.id));
  for (const [i, e] of map.edges.entries()) {
    if (!ids.has(e.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', i, 'from'],
        message: `edge.from "${e.from}" does not reference a known node id`,
      });
    }
    if (!ids.has(e.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', i, 'to'],
        message: `edge.to "${e.to}" does not reference a known node id`,
      });
    }
  }
});
export type ConceptualMapV1 = z.infer<typeof ConceptualMapV1Schema>;

/** Response from GET /clients/[id]/conceptual-map. */
export const ConceptualMapResponseSchema = z.object({
  map: ConceptualMapV1Schema.nullable(),
  /** ISO timestamp of the latest map, or null if none yet. */
  generatedAt: IsoDateTimeSchema.nullable(),
  /** "llm" | "fallback-empty" — fallback when generation failed and we surface an empty placeholder. */
  source: z.enum(['llm', 'fallback-empty']).nullable(),
});
export type ConceptualMapResponse = z.infer<typeof ConceptualMapResponseSchema>;
