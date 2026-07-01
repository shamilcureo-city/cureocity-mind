import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { IntakeNoteV1 } from '@cureocity/contracts';

/**
 * Sprint 49 — Therapist-facing signed-intake-note PDF.
 *
 * Modeled on SignedNotePdf.tsx (same austere print-friendly layout)
 * but laid out around the eight intake sections — presenting concerns,
 * history of presenting illness, past psychiatric history, family
 * history, social history, mental status exam, working hypothesis,
 * immediate plan — plus the riskFlags box. This is the clinician's
 * record of the intake, NOT the patient-friendly version (the portal
 * uses SIGNED_INTAKE_NOTE snapshots for that).
 */
export interface IntakeNotePdfProps {
  note: IntakeNoteV1;
  clientFullName: string;
  sessionId: string;
  scheduledAt: string;
  durationMs: number | null;
  signedBy: string | null;
  signedAt: string | null;
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
  title: {
    fontSize: 18,
    fontFamily: 'Times-Roman',
    marginBottom: 6,
  },
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
  section: {
    marginTop: 14,
  },
  sectionHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#5a5a60',
    marginBottom: 4,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.5,
    color: '#1c1c1e',
  },
  riskBox: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
  },
  riskHigh: {
    borderColor: '#c0392b',
    backgroundColor: '#fdecea',
  },
  riskMedium: {
    borderColor: '#b97a18',
    backgroundColor: '#fcf2dc',
  },
  riskLow: {
    borderColor: '#d4d0c8',
    backgroundColor: '#fbfaf7',
  },
  riskHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  bullet: {
    flexDirection: 'row',
    marginTop: 2,
  },
  bulletDot: { width: 12 },
  signatureBlock: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    fontSize: 9,
    color: '#5a5a60',
  },
});

function riskStyle(severity: string) {
  if (severity === 'high' || severity === 'critical') return styles.riskHigh;
  if (severity === 'medium') return styles.riskMedium;
  return styles.riskLow;
}

export function IntakeNotePdf(props: IntakeNotePdfProps) {
  const { note } = props;
  const durationMin = props.durationMs ? Math.round(props.durationMs / 60_000) : null;
  // Sprint 72 — a templated intake renders its template's sections here; the
  // authoritative eight intake fields stay in the record underneath.
  const hasTemplateSections = Boolean(note.templateSections && note.templateSections.length > 0);
  return (
    <Document
      title={`Intake note — ${props.clientFullName}`}
      author={props.signedBy ?? 'Cureocity Mind'}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Intake Note</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client</Text>
              <Text>{props.clientFullName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Scheduled</Text>
              <Text>{new Date(props.scheduledAt).toLocaleString('en-GB')}</Text>
            </View>
            {durationMin !== null && (
              <View style={styles.metaItem}>
                <Text style={styles.metaKey}>Duration</Text>
                <Text>{durationMin} min</Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Session</Text>
              <Text>{props.sessionId.slice(0, 8)}…</Text>
            </View>
          </View>
        </View>

        {hasTemplateSections ? (
          note.templateSections!.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionHeading}>{s.title}</Text>
              <Text style={styles.body}>{s.body.trim() ? s.body : '—'}</Text>
            </View>
          ))
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Presenting concerns</Text>
              <Text style={styles.body}>{note.presentingConcerns}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>History of presenting illness</Text>
              <Text style={styles.body}>{note.historyOfPresentingIllness}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Past psychiatric history</Text>
              <Text style={styles.body}>{note.pastPsychiatricHistory}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Family history</Text>
              <Text style={styles.body}>{note.familyHistory}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Social history</Text>
              <Text style={styles.body}>{note.socialHistory}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Mental status exam</Text>
              <Text style={styles.body}>{note.mentalStatusExam}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Working hypothesis</Text>
              <Text style={styles.body}>{note.workingHypothesis}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Immediate plan</Text>
              <Text style={styles.body}>{note.immediatePlan}</Text>
            </View>
          </>
        )}

        <View style={[styles.riskBox, riskStyle(note.riskFlags.severity)]}>
          <Text style={styles.riskHeading}>Risk · {note.riskFlags.severity.toUpperCase()}</Text>
          {note.riskFlags.indicators.length > 0 ? (
            note.riskFlags.indicators.map((ind, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.body}>{ind}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.body}>No specific risk indicators flagged.</Text>
          )}
          {note.riskFlags.details && (
            <Text style={[styles.body, { marginTop: 6 }]}>{note.riskFlags.details}</Text>
          )}
        </View>

        <View style={styles.signatureBlock}>
          {props.signedBy && props.signedAt ? (
            <>
              <Text>
                Signed by {props.signedBy} on {new Date(props.signedAt).toLocaleString('en-GB')}
              </Text>
              <Text style={{ marginTop: 2 }}>
                Cureocity Mind · therapeutic documentation system
              </Text>
            </>
          ) : (
            <Text>Unsigned draft — for clinician review only.</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
