import type { RxPadDraft, RxPadPatchOp } from '@cureocity/contracts';
import { drugNameKey } from '@cureocity/clinical';
import type { ScribeFavoriteItem, ScribeShortcut } from './scribe-personalization-contracts';

/** Every favorite is proposed, then applied through the audited unsigned Rx route. */
export function scribeShortcutOps(
  shortcut: ScribeShortcut,
  pad: RxPadDraft | null,
): RxPadPatchOp[] {
  if (shortcut.type === 'set') return scribeShortcutOpGroups(shortcut, pad).flat();
  if (shortcut.type === 'medication') {
    if (pad?.meds?.some((med) => drugNameKey(med.drug) === drugNameKey(shortcut.med.drug)))
      throw new Error('This medicine is already on the plan. Edit its existing row instead.');
    return [
      { op: 'addMed', source: 'manual', med: shortcut.med },
      { op: 'unconfirmMed', drug: shortcut.med.drug },
    ];
  }
  if (shortcut.type === 'investigation') {
    if (
      pad?.investigations?.some(
        (item) => item.name.trim().toLowerCase() === shortcut.name.toLowerCase(),
      )
    )
      throw new Error('This investigation is already on the plan.');
    return [
      {
        op: 'addInvestigation',
        source: 'manual',
        name: shortcut.name,
        ...(shortcut.rationale ? { rationale: shortcut.rationale } : {}),
      },
    ];
  }
  if (shortcut.type === 'advice') {
    if (pad?.adviceLines?.some((line) => line.trim().toLowerCase() === shortcut.text.toLowerCase()))
      throw new Error('This advice is already on the plan.');
    return [{ op: 'addAdvice', source: 'manual', text: shortcut.text }];
  }
  throw new Error('Saved phrases are inserted from the note editor.');
}

export function scribeShortcutDetail(shortcut: ScribeShortcut): string {
  if (shortcut.type === 'set')
    return `${shortcut.items.length} items: ${shortcut.items.map((item) => scribeShortcutDetail(item)).join('; ')}`;
  if (shortcut.type === 'medication')
    return [
      shortcut.med.drug,
      shortcut.med.strength,
      shortcut.med.dose,
      shortcut.med.frequency,
      shortcut.med.timing,
      shortcut.med.route,
      shortcut.med.durationDays && `${shortcut.med.durationDays} days`,
    ]
      .filter(Boolean)
      .join(' · ');
  if (shortcut.type === 'investigation')
    return [shortcut.name, shortcut.rationale].filter(Boolean).join(' — ');
  return shortcut.text;
}

/** Each medicine and its pending marker stay together within the Rx API's 10-op limit. */
export function scribeShortcutOpGroups(
  shortcut: ScribeShortcut,
  pad: RxPadDraft | null,
): RxPadPatchOp[][] {
  if (shortcut.type !== 'set') return [scribeShortcutOps(shortcut, pad)];
  if (shortcut.items.length < 1 || shortcut.items.length > 5)
    throw new Error('A reusable set must contain between 1 and 5 items.');
  const seen = new Set<string>();
  return shortcut.items.map((item) => {
    const identity =
      item.type === 'medication'
        ? `med:${drugNameKey(item.med.drug)}`
        : item.type === 'investigation'
          ? `test:${item.name.trim().toLowerCase()}`
          : `advice:${item.text.trim().toLowerCase()}`;
    if (seen.has(identity))
      throw new Error('This set contains a duplicate item. Edit the set before adding it.');
    seen.add(identity);
    return scribeShortcutOps(item, pad);
  });
}

/** Reusable clinical items only; no diagnosis, patient context, quotes, warnings or note text. */
export function scribeFavoriteSetFromPad(
  pad: RxPadDraft | null,
): Extract<ScribeShortcut, { type: 'set' }> {
  const items: ScribeFavoriteItem[] = [
    ...(pad?.meds ?? [])
      .filter((med) => med.status === 'confirmed')
      .map((med): ScribeFavoriteItem => {
        const { drug, strength, dose, frequency, timing, durationDays, route } = med;
        return {
          type: 'medication',
          title: drug.slice(0, 80),
          med: { drug, strength, dose, frequency, timing, durationDays, route },
        };
      }),
    ...(pad?.investigations ?? []).map(
      (item): ScribeFavoriteItem => ({
        type: 'investigation',
        title: item.name.slice(0, 80),
        name: item.name,
      }),
    ),
    ...(pad?.adviceLines ?? []).map(
      (text): ScribeFavoriteItem => ({ type: 'advice', title: text.slice(0, 80), text }),
    ),
  ];
  return { type: 'set', title: 'Reusable plan', items };
}
