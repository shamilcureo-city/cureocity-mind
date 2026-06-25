import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * Sprint 65 — the consolidated clinical case file.
 *
 * One therapist-facing document assembling the whole chart for a client:
 * identity, diagnoses (current + history), the active treatment plan,
 * outcome measures over time, episodes/discharge, and a chronological
 * session list. Built for referral, supervision, the client's own records,
 * or data-portability. Pure: the route shapes all data; this only renders.
 *
 * Same austere print style as SignedNotePdf — black ink on cream, no
 * gradients, generous margins. Content auto-paginates across the Page.
 */

export interface CaseFileDiagnosis {
  icd11Code: string;
  icd11Label: string;
  confidence: number;
  isPrimary: boolean;
  confirmedAt: string;
  supersededAt: string | null;
}

export interface CaseFilePlan {
  version: number;
  modality: string;
  phaseSequence: string[];
  goals: { description: string; measure: string }[];
  expectedDurationSessions: number | null;
  confirmedAt: string;
}

export interface CaseFileInstrument {
  instrumentKey: string;
  score: number;
  severity: string;
  administeredAt: string;
}

export interface CaseFileEpisode {
  status: string;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  outcomeNote: string | null;
}

export interface CaseFileSession {
  scheduledAt: string;
  kind: string;
  status: string;
  signed: boolean;
  summary: string | null;
}

export interface CaseFilePdfProps {
  clientFullName: string;
  status: string;
  clientSince: string;
  ageYears: number | null;
  presentingConcerns: string | null;
  preparedBy: string;
  rciNumber: string;
  generatedAt: string;
  diagnoses: CaseFileDiagnosis[];
  activePlan: CaseFilePlan | null;
  priorPlanCount: number;
  instruments: CaseFileInstrument[];
  episodes: CaseFileEpisode[];
  sessions: CaseFileSession[];
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#1c1c1e',
    backgroundColor: '#fbfaf7',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#d4d0c8',
    paddingBottom: 12,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontFamily: 'Times-Roman', marginBottom: 6 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    fontSize: 9,
    color: '#5a5a60',
    marginTop: 4,
  },
  metaItem: { marginRight: 12 },
  metaKey: { color: '#888889' },
  section: { marginTop: 16 },
  sectionHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#5a5a60',
    marginBottom: 6,
  },
  body: { fontSize: 11, lineHeight: 1.5, color: '#1c1c1e' },
  muted: { fontSize: 9, color: '#888889' },
  row: { flexDirection: 'row', marginTop: 3 },
  bulletDot: { width: 12 },
  card: {
    borderWidth: 1,
    borderColor: '#e4e0d8',
    borderRadius: 4,
    padding: 8,
    marginTop: 6,
  },
  strong: { fontFamily: 'Helvetica-Bold' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ece8e0',
    paddingVertical: 3,
  },
  cell: { fontSize: 10 },
  empty: { fontSize: 10, color: '#888889', marginTop: 2 },
  signatureBlock: {
    marginTop: 28,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    fontSize: 9,
    color: '#5a5a60',
  },
});

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function CaseFilePdf(props: CaseFilePdfProps) {
  const active = props.diagnoses.filter((d) => d.supersededAt === null);
  const superseded = props.diagnoses.filter((d) => d.supersededAt !== null);

  return (
    <Document
      title={`Case file — ${props.clientFullName}`}
      author={props.preparedBy}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.title}>Clinical Case File</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client</Text>
              <Text>{props.clientFullName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Status</Text>
              <Text>{props.status}</Text>
            </View>
            {props.ageYears !== null && (
              <View style={styles.metaItem}>
                <Text style={styles.metaKey}>Age</Text>
                <Text>{props.ageYears}</Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client since</Text>
              <Text>{fmtDate(props.clientSince)}</Text>
            </View>
          </View>
        </View>

        {props.presentingConcerns && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Presenting concerns</Text>
            <Text style={styles.body}>{props.presentingConcerns}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Diagnoses</Text>
          {active.length === 0 && superseded.length === 0 && (
            <Text style={styles.empty}>No confirmed diagnoses on record.</Text>
          )}
          {active.map((d, i) => (
            <View key={`a${i}`} style={styles.row}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.body}>
                <Text style={styles.strong}>{d.icd11Code}</Text> {d.icd11Label}
                {d.isPrimary ? ' (primary)' : ''} · {Math.round(d.confidence * 100)}% · confirmed{' '}
                {fmtDate(d.confirmedAt)}
              </Text>
            </View>
          ))}
          {superseded.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={styles.muted}>Earlier (superseded)</Text>
              {superseded.map((d, i) => (
                <View key={`s${i}`} style={styles.row}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={[styles.body, { color: '#6a6a70' }]}>
                    {d.icd11Code} {d.icd11Label} · confirmed {fmtDate(d.confirmedAt)}
                    {d.supersededAt ? `, replaced ${fmtDate(d.supersededAt)}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Treatment plan</Text>
          {props.activePlan ? (
            <View style={styles.card}>
              <Text style={styles.body}>
                <Text style={styles.strong}>{props.activePlan.modality}</Text> · v
                {props.activePlan.version} · confirmed {fmtDate(props.activePlan.confirmedAt)}
                {props.activePlan.expectedDurationSessions !== null
                  ? ` · ~${props.activePlan.expectedDurationSessions} sessions`
                  : ''}
              </Text>
              {props.activePlan.phaseSequence.length > 0 && (
                <Text style={[styles.body, { marginTop: 4 }]}>
                  Phases: {props.activePlan.phaseSequence.join(' → ')}
                </Text>
              )}
              {props.activePlan.goals.map((g, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.body}>
                    {g.description} <Text style={styles.muted}>— measure: {g.measure}</Text>
                  </Text>
                </View>
              ))}
              {props.priorPlanCount > 0 && (
                <Text style={[styles.muted, { marginTop: 4 }]}>
                  {props.priorPlanCount} earlier plan version
                  {props.priorPlanCount === 1 ? '' : 's'} on record.
                </Text>
              )}
            </View>
          ) : (
            <Text style={styles.empty}>No treatment plan confirmed yet.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Outcome measures</Text>
          {props.instruments.length === 0 ? (
            <Text style={styles.empty}>No questionnaires administered yet.</Text>
          ) : (
            <View>
              <View style={[styles.tableRow, { borderBottomColor: '#d4d0c8' }]}>
                <Text style={[styles.cell, styles.muted, { width: '30%' }]}>Date</Text>
                <Text style={[styles.cell, styles.muted, { width: '25%' }]}>Tool</Text>
                <Text style={[styles.cell, styles.muted, { width: '15%' }]}>Score</Text>
                <Text style={[styles.cell, styles.muted, { width: '30%' }]}>Severity</Text>
              </View>
              {props.instruments.map((m, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.cell, { width: '30%' }]}>{fmtDate(m.administeredAt)}</Text>
                  <Text style={[styles.cell, { width: '25%' }]}>{m.instrumentKey}</Text>
                  <Text style={[styles.cell, { width: '15%' }]}>{m.score}</Text>
                  <Text style={[styles.cell, { width: '30%' }]}>
                    {m.severity.replace(/_/g, ' ')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {props.episodes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Episodes of care</Text>
            {props.episodes.map((e, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.body}>
                  {fmtDate(e.openedAt)} — {e.closedAt ? fmtDate(e.closedAt) : 'ongoing'} ·{' '}
                  {e.status}
                  {e.closeReason ? ` · ${e.closeReason}` : ''}
                  {e.outcomeNote ? `\n${e.outcomeNote}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Session history</Text>
          {props.sessions.length === 0 ? (
            <Text style={styles.empty}>No sessions yet.</Text>
          ) : (
            props.sessions.map((s, i) => (
              <View key={i} style={[styles.card, { marginTop: 6 }]} wrap={false}>
                <Text style={styles.body}>
                  <Text style={styles.strong}>{fmtDate(s.scheduledAt)}</Text> · {s.kind} ·{' '}
                  {s.status}
                  {s.signed ? ' · signed' : ' · unsigned'}
                </Text>
                {s.summary && (
                  <Text style={[styles.body, { marginTop: 2, color: '#3a3a40' }]}>{s.summary}</Text>
                )}
              </View>
            ))
          )}
        </View>

        <View style={styles.signatureBlock}>
          <Text>
            Prepared by {props.preparedBy} (RCI {props.rciNumber}) on{' '}
            {new Date(props.generatedAt).toLocaleString('en-GB')}
          </Text>
          <Text style={{ marginTop: 2 }}>
            Cureocity Mind · clinical documentation. Confidential — handle under DPDP.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
