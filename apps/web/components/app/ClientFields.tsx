'use client';

import { useState } from 'react';
import type { ClientDraft, ClientDraftModality } from '@/lib/client-draft';
import { CheckboxRow, Input, Label, Select, Textarea } from '../ui/Field';
import { PhoneField } from './PhoneField';
import { SpokenLanguageChips } from './SpokenLanguageChips';

/**
 * The client fields, shared by both entry points.
 *
 * Record's "+ New client" and the Clients page's "Create client" used to be
 * two different forms — different fields, different consent rules, different
 * layout — so which one you got depended on where you happened to click. This
 * is the single set.
 *
 * Quick by default: a client sitting in front of you needs name, phone and a
 * consent confirmation, nothing more. Everything else — email, date of birth,
 * languages, modality, presenting concerns — is real but rarely urgent, so it
 * sits behind "More details" and can equally be filled in later from the
 * client page. The expander opens automatically when a draft already carries
 * one of those values, so an edit never hides what is there.
 */

interface Props {
  value: ClientDraft;
  onChange: (next: ClientDraft) => void;
  /** Doctors have no therapy modality. */
  isDoctor?: boolean;
  /** Administrative Mind creation defers today's capture consent to preflight. */
  purpose?: 'ADMINISTRATIVE' | 'CAPTURE';
  idPrefix?: string;
  autoFocusName?: boolean;
}

export function ClientFields({
  value,
  onChange,
  isDoctor = false,
  purpose = 'CAPTURE',
  idPrefix = 'cf',
  autoFocusName,
}: Props) {
  const hasDetails =
    value.contactEmail !== '' ||
    value.dateOfBirth !== '' ||
    value.presentingConcerns !== '' ||
    value.preferredModality !== '' ||
    value.preferredLanguage !== 'en' ||
    value.spokenLanguages.length > 0;
  const [open, setOpen] = useState(hasDetails);
  const set = <K extends keyof ClientDraft>(k: K, v: ClientDraft[K]) =>
    onChange({ ...value, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={id('name')}>Their name</Label>
          <Input
            id={id('name')}
            value={value.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            required
            maxLength={200}
            autoFocus={autoFocusName}
            autoComplete="off"
          />
        </div>
        <PhoneField
          id={id('phone')}
          value={value.contactPhone}
          onChange={(v) => set('contactPhone', v)}
          required={isDoctor || purpose === 'CAPTURE'}
        />
      </div>

      {isDoctor || purpose === 'CAPTURE' ? (
        <div>
          <Label>Today&apos;s recording confirmation</Label>
          <div className="mt-2 space-y-2">
            <CheckboxRow
              id={id('audio')}
              checked={value.audioOk}
              onChange={(v) => set('audioOk', v)}
              label="Audio recording — they've agreed"
              description="We record this session so the AI can draft a note."
            />
            <CheckboxRow
              id={id('note')}
              checked={value.noteOk}
              onChange={(v) => set('noteOk', v)}
              label="AI note generation — they've agreed"
              description="An AI processes the recording into a draft you'll review."
            />
            <CheckboxRow
              id={id('xborder')}
              checked={value.crossBorderOk}
              onChange={(v) => set('crossBorderOk', v)}
              label="Note analysis outside India — they've agreed"
              description="The transcript (never the audio) may be analysed on a global model. Required — recording is blocked without it."
            />
            <CheckboxRow
              id={id('retention')}
              checked={value.retentionExtended}
              onChange={(v) => set('retentionExtended', v)}
              label="Keep data beyond 30 days"
              description="Optional. Audio is deleted after 30 days unless they agreed otherwise."
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink-2)]">
          Recording consent is confirmed separately for each session before capture starts. Creating
          this client does not claim they agreed today.
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-line-soft)]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
        >
          <span aria-hidden>{open ? '▾' : '▸'}</span>
          More details
          <span className="font-normal text-[var(--color-ink-3)]">
            — optional, and editable later
          </span>
        </button>

        {open && (
          <div className="space-y-4 border-t border-[var(--color-line-soft)] p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={id('email')} hint="optional">
                  Email
                </Label>
                <Input
                  id={id('email')}
                  type="email"
                  value={value.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={id('dob')} hint="optional">
                  Date of birth
                </Label>
                <Input
                  id={id('dob')}
                  type="date"
                  value={value.dateOfBirth}
                  onChange={(e) => set('dateOfBirth', e.target.value)}
                />
              </div>
              {!isDoctor && (
                <div>
                  <Label htmlFor={id('modality')} hint="optional">
                    Preferred modality
                  </Label>
                  <Select
                    id={id('modality')}
                    value={value.preferredModality}
                    onChange={(e) =>
                      set('preferredModality', e.target.value as ClientDraftModality)
                    }
                  >
                    <option value="">—</option>
                    <option value="CBT">CBT</option>
                    <option value="EMDR">EMDR</option>
                    <option value="OTHER">Other</option>
                  </Select>
                  <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                    Leave blank for an intake — the first session is how you decide.
                  </p>
                </div>
              )}
              <div>
                <Label htmlFor={id('lang')} hint="patient-facing">
                  Preferred language
                </Label>
                <Select
                  id={id('lang')}
                  value={value.preferredLanguage}
                  onChange={(e) => set('preferredLanguage', e.target.value)}
                >
                  <option value="en">English</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="bn">Bengali (বাংলা)</option>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor={id('spoken')} hint="optional · multi-select">
                Typical spoken languages
              </Label>
              <SpokenLanguageChips
                value={value.spokenLanguages}
                onChange={(v) => set('spokenLanguages', v)}
              />
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">
                A transcription hint. Pick more than one for code-mixed speakers (Manglish: ml +
                en).
              </p>
            </div>

            <div>
              <Label htmlFor={id('concerns')} hint="optional · 0–2000 chars">
                Presenting concerns
              </Label>
              <Textarea
                id={id('concerns')}
                rows={3}
                value={value.presentingConcerns}
                onChange={(e) => set('presentingConcerns', e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
