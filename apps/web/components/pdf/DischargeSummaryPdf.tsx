import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfDate, formatPdfDateTime } from '@/lib/doc-format';

/**
 * Sprint 65b — the clinician-facing discharge / treatment summary.
 *
 * A formal end-of-episode document: why care started, what was worked on
 * and whether the goals were met, the measured outcome (first → last
 * scores), the course of treatment, and the reason for ending plus any
 * aftercare note. Distinct from the patient-facing Progress Report — this
 * is for the referrer, the next clinician, supervision, or the file.
 *
 * Pure: the route shapes all data; this only renders. Same austere print
 * style as the other PDFs.
 */

export interface DischargeGoal {
  description: string;
  measure: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'ACHIEVED';
}

export interface DischargeOutcome {
  instrumentKey: string;
  firstScore: number;
  lastScore: number;
  firstAt: string;
  lastAt: string;
  /** lastScore - firstScore (negative = improvement on PHQ-9/GAD-7). */
  change: number;
  /**
   * 'improved'/'worse' are only emitted for instruments KNOWN to be
   * lower-is-better (symptom scales). 'changed' is the polarity-neutral
   * fallback for any instrument whose direction-of-good isn't known, so the
   * summary never claims an improvement/worsening it can't justify.
   */
  direction: 'improved' | 'worse' | 'no-change' | 'changed';
}

export interface DischargeSummaryPdfProps {
  clientFullName: string;
  ageYears: number | null;
  preparedBy: string;
  rciNumber: string;
  generatedAt: string;
  episodeStatus: string;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  outcomeNote: string | null;
  completedSessions: number;
  presentingConcerns: string | null;
  finalDiagnosis: { icd11Code: string; icd11Label: string } | null;
  goals: DischargeGoal[];
  outcomes: DischargeOutcome[];
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
  return formatPdfDate(iso);
}

const GOAL_LABEL: Record<DischargeGoal['status'], string> = {
  NOT_STARTED: 'not started',
  IN_PROGRESS: 'in progress',
  ACHIEVED: 'achieved',
};

const DIRECTION_LABEL: Record<DischargeOutcome['direction'], string> = {
  improved: 'improved',
  worse: 'worsened',
  'no-change': 'no change',
  changed: 'changed',
};

export function DischargeSummaryPdf(props: DischargeSummaryPdfProps) {
  const closed = props.episodeStatus === 'DISCHARGED' || props.episodeStatus === 'TRANSFERRED';
  return (
    <Document
      title={`Discharge summary — ${props.clientFullName}`}
      author={props.preparedBy}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.title}>{closed ? 'Discharge Summary' : 'Treatment Summary'}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client</Text>
              <Text>{props.clientFullName}</Text>
            </View>
            {props.ageYears !== null && (
              <View style={styles.metaItem}>
                <Text style={styles.metaKey}>Age</Text>
                <Text>{props.ageYears}</Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Episode</Text>
              <Text>
                {fmtDate(props.openedAt)} — {props.closedAt ? fmtDate(props.closedAt) : 'ongoing'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Status</Text>
              <Text>{props.episodeStatus}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Sessions</Text>
              <Text>{props.completedSessions}</Text>
            </View>
          </View>
        </View>

        {props.presentingConcerns && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Reason for care</Text>
            <Text style={styles.body}>{props.presentingConcerns}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Working diagnosis</Text>
          {props.finalDiagnosis ? (
            <Text style={styles.body}>
              {props.finalDiagnosis.icd11Code} {props.finalDiagnosis.icd11Label}
            </Text>
          ) : (
            <Text style={styles.empty}>No confirmed diagnosis on record.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Goals &amp; progress</Text>
          {props.goals.length === 0 ? (
            <Text style={styles.empty}>No treatment-plan goals on record.</Text>
          ) : (
            props.goals.map((g, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.body}>
                  {g.description} —{' '}
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{GOAL_LABEL[g.status]}</Text>
                  <Text style={styles.muted}> (measure: {g.measure})</Text>
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Measured outcome</Text>
          {props.outcomes.length === 0 ? (
            <Text style={styles.empty}>No questionnaires administered during this episode.</Text>
          ) : (
            <View>
              <View style={[styles.tableRow, { borderBottomColor: '#d4d0c8' }]}>
                <Text style={[styles.cell, styles.muted, { width: '20%' }]}>Tool</Text>
                <Text style={[styles.cell, styles.muted, { width: '25%' }]}>First</Text>
                <Text style={[styles.cell, styles.muted, { width: '25%' }]}>Last</Text>
                <Text style={[styles.cell, styles.muted, { width: '30%' }]}>Outcome</Text>
              </View>
              {props.outcomes.map((o, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.cell, { width: '20%' }]}>{o.instrumentKey}</Text>
                  <Text style={[styles.cell, { width: '25%' }]}>
                    {o.firstScore} ({fmtDate(o.firstAt)})
                  </Text>
                  <Text style={[styles.cell, { width: '25%' }]}>
                    {o.lastScore} ({fmtDate(o.lastAt)})
                  </Text>
                  <Text style={[styles.cell, { width: '30%' }]}>
                    {DIRECTION_LABEL[o.direction]}
                    {o.direction !== 'no-change' ? ` (${Math.abs(o.change)} pts)` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {(props.closeReason || props.outcomeNote) && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>
              {closed ? 'Reason for discharge' : 'Clinician note'}
            </Text>
            {props.closeReason && <Text style={styles.body}>{props.closeReason}</Text>}
            {props.outcomeNote && (
              <Text style={[styles.body, { marginTop: 4 }]}>{props.outcomeNote}</Text>
            )}
          </View>
        )}

        <View style={styles.signatureBlock}>
          <Text>
            Prepared by {props.preparedBy} (RCI {props.rciNumber}) on{' '}
            {formatPdfDateTime(props.generatedAt)}
          </Text>
          <Text style={{ marginTop: 2 }}>
            Cureocity Mind · clinical documentation. Confidential — handle under DPDP.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
