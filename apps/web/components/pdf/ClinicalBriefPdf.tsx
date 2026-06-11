import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ClinicalReportV1 } from '@cureocity/contracts';

/**
 * Sprint 38 — therapist-facing Clinical Brief PDF (Pass 3 output).
 *
 * Companion to SignedNotePdf: where that exports the signed SOAP note,
 * this exports the clinical reasoning — ICD-11 diagnosis candidates,
 * formulation, treatment plan, recommended therapies, assessment gaps,
 * and any crisis flags. Same austere print aesthetic (black on cream).
 *
 * Every page carries the "AI suggestion, clinician-confirmed" framing so
 * a printed brief can't be mistaken for an autonomous diagnosis.
 */
export interface ClinicalBriefPdfProps {
  report: ClinicalReportV1;
  clientFullName: string;
  sessionId: string;
  scheduledAt: string;
  generatedAt: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#1c1c1e',
    backgroundColor: '#fbfaf7',
  },
  header: { borderBottomWidth: 1, borderBottomColor: '#d4d0c8', paddingBottom: 12, marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Times-Roman', marginBottom: 6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, fontSize: 9, color: '#5a5a60', marginTop: 4 },
  metaItem: { marginRight: 16 },
  metaKey: { color: '#888889' },
  disclaimer: { fontSize: 8, fontStyle: 'italic', color: '#888889', marginTop: 6 },
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
  dx: { marginBottom: 8 },
  dxHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  dxCode: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  dxLabel: { fontSize: 11, flex: 1 },
  dxMeta: { fontSize: 9, color: '#5a5a60' },
  primaryTag: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#2d5f4d',
    backgroundColor: '#e8f0eb',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  quote: { fontSize: 9, fontStyle: 'italic', color: '#5a5a60', marginTop: 2, marginLeft: 10 },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 6 },
  goal: { marginTop: 4 },
  goalDesc: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  goalMeasure: { fontSize: 9, color: '#5a5a60' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  chip: { fontSize: 9, color: '#5a5a60', marginRight: 6 },
  therapy: { marginBottom: 6 },
  therapyName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  gap: { marginBottom: 5 },
  crisisBox: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#c0392b',
    backgroundColor: '#fdecea',
    borderRadius: 4,
    padding: 10,
  },
  crisisHeading: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#c0392b', marginBottom: 4 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 56,
    right: 56,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    paddingTop: 8,
    fontSize: 8,
    color: '#888889',
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ClinicalBriefPdf(props: ClinicalBriefPdfProps) {
  const { report } = props;
  const primaryIdx = report.primaryDiagnosisIndex;
  return (
    <Document
      title={`Clinical brief — ${props.clientFullName}`}
      author="Cureocity Mind"
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Clinical Brief</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client</Text>
              <Text>{props.clientFullName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Session date</Text>
              <Text>{fmtDate(props.scheduledAt)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Modality</Text>
              <Text>{report.modality}</Text>
            </View>
          </View>
          <Text style={styles.disclaimer}>
            AI-generated clinical reasoning, reviewed and confirmed by the treating clinician. Not
            an autonomous diagnosis.
          </Text>
        </View>

        {/* Diagnoses */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Diagnosis candidates (ICD-11)</Text>
          {report.diagnosisCandidates.length === 0 ? (
            <Text style={styles.body}>No diagnosis candidates proposed.</Text>
          ) : (
            report.diagnosisCandidates.map((d, i) => (
              <View key={i} style={styles.dx} wrap={false}>
                <View style={styles.dxHead}>
                  <Text style={styles.dxCode}>{d.icd11Code}</Text>
                  <Text style={styles.dxLabel}>{d.icd11Label}</Text>
                  {primaryIdx === i && <Text style={styles.primaryTag}>PRIMARY</Text>}
                </View>
                <Text style={styles.dxMeta}>Confidence {Math.round(d.confidence * 100)}%</Text>
                {d.supportingEvidence.slice(0, 3).map((q, j) => (
                  <Text key={j} style={styles.quote}>
                    “{q.quote}” — {q.speaker}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>

        {/* Formulation */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Formulation</Text>
          <Text style={styles.body}>{report.formulation}</Text>
        </View>

        {/* Treatment plan */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Treatment plan</Text>
          <View style={styles.planGrid}>
            <Text style={styles.chip}>Modality: {report.treatmentPlan.modality}</Text>
            <Text style={styles.chip}>
              Duration:{' '}
              {report.treatmentPlan.expectedDurationSessions !== null
                ? `${report.treatmentPlan.expectedDurationSessions} sessions`
                : 'uncertain'}
            </Text>
          </View>
          <View style={styles.chipRow}>
            {report.treatmentPlan.phaseSequence.map((p, i) => (
              <Text key={i} style={styles.chip}>
                {i + 1}. {p}
              </Text>
            ))}
          </View>
          {report.treatmentPlan.goals.map((g, i) => (
            <View key={i} style={styles.goal} wrap={false}>
              <Text style={styles.goalDesc}>• {g.description}</Text>
              <Text style={styles.goalMeasure}>measure: {g.measure}</Text>
            </View>
          ))}
        </View>

        {/* Recommended therapies */}
        {report.recommendedTherapies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Recommended therapies</Text>
            {report.recommendedTherapies.map((t, i) => (
              <View key={i} style={styles.therapy} wrap={false}>
                <Text style={styles.therapyName}>
                  {t.name} <Text style={styles.goalMeasure}>· {t.whenInPlan}</Text>
                </Text>
                <Text style={styles.body}>{t.rationale}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Assessment gaps */}
        {report.assessmentGaps.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Assessment gaps</Text>
            {report.assessmentGaps.map((g, i) => (
              <View key={i} style={styles.gap} wrap={false}>
                <Text style={styles.goalDesc}>• {g.question}</Text>
                <Text style={styles.goalMeasure}>{g.rationale}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Crisis flags */}
        {report.crisisFlags.map((c, i) => (
          <View key={i} style={styles.crisisBox} wrap={false}>
            <Text style={styles.crisisHeading}>
              Crisis flag — {c.kind.replace(/_/g, ' ')} ({c.severity})
            </Text>
            <Text style={styles.body}>{c.recommendedAction}</Text>
            {c.indicators.slice(0, 3).map((q, j) => (
              <Text key={j} style={styles.quote}>
                “{q.quote}” — {q.speaker}
              </Text>
            ))}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Cureocity Mind · Clinical brief generated {fmtDate(props.generatedAt)} · Confirmed
          diagnoses and plans are recorded on the client&rsquo;s cumulative record. Not a medical
          device.
        </Text>
      </Page>
    </Document>
  );
}
