import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TherapyNoteV1 } from '@cureocity/contracts';

/**
 * Therapist-facing signed-note PDF. Ported in spirit from
 * services/pdf-generator-service/src/templates/session-note.template.ts
 * but using @react-pdf/renderer instead of Puppeteer — the latter
 * needs a Chromium binary that doesn't run in Vercel's serverless
 * runtime. The visual layout is intentionally austere: black ink on
 * cream, no gradients, generous margins for printability.
 */
export interface SignedNotePdfProps {
  note: TherapyNoteV1;
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

export function SignedNotePdf(props: SignedNotePdfProps) {
  const { note } = props;
  const durationMin = props.durationMs ? Math.round(props.durationMs / 60_000) : null;
  // Sprint 72 — when the note was written into a template, the clinician's
  // PDF renders that template's sections (the authoritative SOAP fields stay
  // in the record underneath). Mirrors the on-screen note + IntakeNotePdf.
  const hasTemplateSections = Boolean(note.templateSections && note.templateSections.length > 0);
  return (
    <Document
      title={`Session note — ${props.clientFullName}`}
      author={props.signedBy ?? 'Cureocity Mind'}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Session Note</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Client</Text>
              <Text>{props.clientFullName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaKey}>Modality</Text>
              <Text>{note.modality}</Text>
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
              <Text style={styles.sectionHeading}>Subjective</Text>
              <Text style={styles.body}>{note.subjective}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Objective</Text>
              <Text style={styles.body}>{note.objective}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Assessment</Text>
              <Text style={styles.body}>{note.assessment}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Plan</Text>
              <Text style={styles.body}>{note.plan}</Text>
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

        {note.phaseHints.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Phase hints</Text>
            {note.phaseHints.map((h, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.body}>
                  {h.phase} ({(h.confidence * 100).toFixed(0)}%)
                  {h.rationale ? ` — ${h.rationale}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

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
