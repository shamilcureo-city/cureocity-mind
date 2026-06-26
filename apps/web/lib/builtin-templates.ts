/**
 * Sprint 70 (template library, phase C) — the built-in note-template catalog.
 *
 * A static, app-global library of well-known note structures, grouped the way
 * the reference template organises them. They are NOT per-therapist DB rows
 * (no seeding, no migration): a built-in template id is `builtin:<key>`, and
 * both the generate pipeline (server) and the picker (client) import this
 * module. The therapist's own custom templates (the /app/templates builder)
 * sit alongside these under "Your templates".
 *
 * Plain data only — safe to import from both server and client.
 */

export interface BuiltinTemplateSection {
  title: string;
  hint?: string;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  /** Group heading in the picker. */
  category: string;
  sections: BuiltinTemplateSection[];
}

export const BUILTIN_TEMPLATE_PREFIX = 'builtin:';

export function isBuiltinTemplateId(id: string): boolean {
  return id.startsWith(BUILTIN_TEMPLATE_PREFIX);
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ---- Progress notes (format-shaped) -------------------------------------
  {
    id: 'builtin:dap',
    name: 'DAP',
    category: 'Progress notes',
    sections: [
      { title: 'Data', hint: 'What the client reported and what you observed' },
      { title: 'Assessment', hint: 'Your clinical read + progress' },
      { title: 'Plan', hint: 'Next steps, homework, next focus' },
    ],
  },
  {
    id: 'builtin:birp',
    name: 'BIRP',
    category: 'Progress notes',
    sections: [
      { title: 'Behaviour', hint: 'How the client presented' },
      { title: 'Intervention', hint: 'What was worked on this session' },
      { title: 'Response', hint: 'How the client responded' },
      { title: 'Plan', hint: 'Next steps' },
    ],
  },
  {
    id: 'builtin:girp',
    name: 'GIRP',
    category: 'Progress notes',
    sections: [
      { title: 'Goal', hint: 'The goal worked toward this session' },
      { title: 'Intervention', hint: 'What you did' },
      { title: 'Response', hint: 'The client’s response' },
      { title: 'Plan', hint: 'Next steps' },
    ],
  },
  {
    id: 'builtin:pie',
    name: 'PIE',
    category: 'Progress notes',
    sections: [
      { title: 'Problem', hint: 'The focus problem' },
      { title: 'Intervention', hint: 'What was done' },
      { title: 'Evaluation', hint: 'Effect + progress' },
    ],
  },
  // ---- Process notes (modality-shaped) ------------------------------------
  {
    id: 'builtin:cbt',
    name: 'CBT progress note',
    category: 'Process notes',
    sections: [
      { title: 'Presenting issue', hint: 'Focus of the session' },
      { title: 'Thoughts / cognitions', hint: 'Automatic thoughts, distortions identified' },
      { title: 'Behaviours', hint: 'Avoidance, safety behaviours, experiments' },
      { title: 'Intervention', hint: 'Techniques used (thought records, exposure, …)' },
      { title: 'Homework', hint: 'Agreed between-session practice' },
    ],
  },
  {
    id: 'builtin:emdr',
    name: 'EMDR session note',
    category: 'Process notes',
    sections: [
      { title: 'Target', hint: 'Memory / image targeted' },
      { title: 'SUDS', hint: 'Distress 0–10 before and after' },
      { title: 'Phase', hint: 'EMDR phase covered' },
      { title: 'Processing & installation', hint: 'What shifted; positive cognition' },
      { title: 'Plan', hint: 'Next target / next steps' },
    ],
  },
  {
    id: 'builtin:act',
    name: 'ACT session note',
    category: 'Process notes',
    sections: [
      { title: 'Values', hint: 'Values touched this session' },
      { title: 'Workability', hint: 'What is / isn’t working for the client' },
      { title: 'Defusion & acceptance', hint: 'Work done with thoughts/feelings' },
      { title: 'Committed action', hint: 'Agreed values-based steps' },
    ],
  },
  // ---- Group / relational -------------------------------------------------
  {
    id: 'builtin:couple',
    name: 'Couples session note',
    category: 'Group notes',
    sections: [
      { title: 'Presenting concern', hint: 'What the couple brought today' },
      { title: 'Interaction pattern', hint: 'Cycle / dynamic observed' },
      { title: 'Intervention', hint: 'What was worked on with the dyad' },
      { title: 'Homework', hint: 'Agreed between-session practice' },
    ],
  },
  // ---- Administrative -----------------------------------------------------
  {
    id: 'builtin:insurance',
    name: 'Insurance-friendly note',
    category: 'Other',
    sections: [
      { title: 'Diagnosis', hint: 'Working diagnosis' },
      { title: 'Medical necessity', hint: 'Why treatment is needed' },
      { title: 'Symptoms & severity', hint: 'Current presentation' },
      { title: 'Intervention', hint: 'Treatment provided this session' },
      { title: 'Progress', hint: 'Response to treatment' },
      { title: 'Plan', hint: 'Continued treatment plan' },
    ],
  },
];

export function resolveBuiltinTemplate(id: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Built-in templates grouped by category, in catalog order. */
export function builtinTemplatesByCategory(): { category: string; templates: BuiltinTemplate[] }[] {
  const groups: { category: string; templates: BuiltinTemplate[] }[] = [];
  for (const t of BUILTIN_TEMPLATES) {
    let group = groups.find((g) => g.category === t.category);
    if (!group) {
      group = { category: t.category, templates: [] };
      groups.push(group);
    }
    group.templates.push(t);
  }
  return groups;
}
