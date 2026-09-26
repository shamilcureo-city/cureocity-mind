export interface ScribeCorrection {
  before: string;
  after: string;
  description: string;
}

/** Deliberate typed commands only. No model call, global listener or ambient transcript input. */
export function previewScribeCorrection(current: string, command: string): ScribeCorrection {
  const text = command.trim();
  let after: string;
  let description: string;
  const replace = /^replace\s+"([^"]+)"\s+with\s+"([^"]*)"$/i.exec(text);
  if (replace) {
    const [, from, to] = replace;
    const matches = current.split(from!).length - 1;
    if (matches !== 1)
      throw new Error(
        matches === 0
          ? 'That text is not in this section.'
          : 'More than one match. Include more surrounding text to identify one correction.',
      );
    after = current.replace(from!, () => to!);
    description = 'Replace the selected wording';
  } else if (/^append:\s*\S/i.test(text)) {
    after = [current.trim(), text.replace(/^append:\s*/i, '')].filter(Boolean).join('\n');
    description = 'Append to this section';
  } else if (/^set:\s*\S/i.test(text)) {
    after = text.replace(/^set:\s*/i, '');
    description = 'Replace this entire section';
  } else {
    throw new Error('Use replace "old text" with "new text", append: text, or set: text.');
  }
  if (after.length > 40_000) throw new Error('This correction is too long.');
  if (after === current) throw new Error('This command does not change the section.');
  return { before: current, after, description };
}

export function applyScribeCorrection(current: string, proposal: ScribeCorrection): string {
  if (current !== proposal.before)
    throw new Error('The section changed after preview. Preview the correction again.');
  return proposal.after;
}

export function undoScribeCorrection(current: string, proposal: ScribeCorrection): string {
  if (current !== proposal.after)
    throw new Error('The section has newer edits. Undo those edits manually to avoid losing them.');
  return proposal.before;
}
