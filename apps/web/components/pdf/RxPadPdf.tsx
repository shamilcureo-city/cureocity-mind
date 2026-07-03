import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { RxPadV1 } from '@cureocity/contracts';
import { formatPdfDate, formatPdfDateTime } from '@/lib/doc-format';

/**
 * Sprint DS5-fu — the doctor's prescription pad as a printable letterhead
 * Rx. Pure functional component (the route supplies all text). Same austere
 * print style as the other clinical PDFs (LetterPdf / DischargeSummaryPdf).
 *
 * Only CONFIRMED medications are the actual prescription — the route filters
 * `pending` (unconfirmed AI/voice) rows out before rendering. The 'Rx' mark
 * is literal text, not the ℞ glyph (U+211E is not in the built-in
 * Helvetica/Times AFM fonts — it would tofu).
 */
export interface RxPadPdfProps {
  rx: RxPadV1;
  clientFullName: string;
  ageYears: number | null;
  sessionId: string;
  scheduledAt: string;
  prescriberName: string;
  medicalRegNumber: string | null;
  rciNumber: string | null;
  specialty: string | null;
  clinicName: string | null;
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
    lineHeight: 1.5,
  },
  letterhead: {
    borderBottomWidth: 1,
    borderBottomColor: '#d4d0c8',
    paddingBottom: 10,
    marginBottom: 12,
  },
  clinicName: { fontSize: 15, fontFamily: 'Times-Roman' },
  prescriber: { fontSize: 12, marginTop: 2 },
  credential: { fontSize: 9, color: '#5a5a60', marginTop: 2 },
  patientRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  metaItem: { fontSize: 9, color: '#5a5a60', marginRight: 16 },
  metaKey: { color: '#888889' },
  rxGlyph: { fontSize: 22, fontFamily: 'Times-Roman', marginTop: 12, marginBottom: 2 },
  section: { marginTop: 12 },
  sectionHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#5a5a60',
    marginBottom: 6,
  },
  dxLine: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  muted: { fontSize: 9, color: '#888889', marginTop: 4 },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d4d0c8',
    paddingBottom: 3,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ece8e0',
    paddingVertical: 4,
  },
  cDrug: { width: '38%', fontSize: 10 },
  cDose: { width: '20%', fontSize: 10 },
  cFreq: { width: '22%', fontSize: 10 },
  cDur: { width: '20%', fontSize: 10 },
  headCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    color: '#888889',
  },
  continued: { fontSize: 8, color: '#888889' },
  warn: { fontSize: 8, color: '#b97a18', marginTop: 1 },
  bullet: { flexDirection: 'row', marginTop: 2 },
  bulletDot: { width: 12, fontSize: 11 },
  bulletText: { flex: 1, fontSize: 11 },
  allergyBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#c0392b',
    backgroundColor: '#fdecea',
    borderRadius: 4,
    padding: 8,
    fontSize: 10,
    color: '#8a2b20',
  },
  signatureBlock: {
    marginTop: 28,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    fontSize: 9,
    color: '#5a5a60',
  },
  footer: { marginTop: 20, fontSize: 8, color: '#888889' },
});

function metaItem(key: string, value: string) {
  return (
    <Text style={styles.metaItem}>
      <Text style={styles.metaKey}>{key} </Text>
      {value}
    </Text>
  );
}

export function RxPadPdf(props: RxPadPdfProps) {
  const { rx } = props;
  const meds = rx.meds.filter((m) => m.status === 'confirmed');
  const credential = [
    props.specialty,
    props.medicalRegNumber
      ? `Reg. ${props.medicalRegNumber}`
      : props.rciNumber
        ? `RCI ${props.rciNumber}`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Document
      title={`Prescription — ${props.clientFullName}`}
      author={props.prescriberName}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Letterhead */}
        <View style={styles.letterhead}>
          {props.clinicName ? <Text style={styles.clinicName}>{props.clinicName}</Text> : null}
          <Text style={styles.prescriber}>{props.prescriberName}</Text>
          {credential ? <Text style={styles.credential}>{credential}</Text> : null}
          <View style={styles.patientRow}>
            {metaItem('Patient', props.clientFullName)}
            {props.ageYears != null ? metaItem('Age', String(props.ageYears)) : null}
            {metaItem('Date', formatPdfDate(props.scheduledAt, { month: 'long' }))}
            {metaItem('Rx No.', props.sessionId.slice(0, 8))}
          </View>
        </View>

        <Text style={styles.rxGlyph}>Rx</Text>

        {rx.dxLine ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Diagnosis</Text>
            <Text style={styles.dxLine}>{rx.dxLine}</Text>
          </View>
        ) : null}

        {rx.vitalsLine ? <Text style={styles.muted}>{rx.vitalsLine}</Text> : null}

        {rx.allergies.length > 0 ? (
          <Text style={styles.allergyBox}>Allergies: {rx.allergies.join(', ')}</Text>
        ) : null}

        {meds.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Medications</Text>
            <View style={styles.tableHead}>
              <Text style={[styles.cDrug, styles.headCell]}>Drug</Text>
              <Text style={[styles.cDose, styles.headCell]}>Dose</Text>
              <Text style={[styles.cFreq, styles.headCell]}>Frequency</Text>
              <Text style={[styles.cDur, styles.headCell]}>Duration</Text>
            </View>
            {meds.map((m, i) => (
              <View key={`${m.drug}-${i}`} style={styles.tableRow} wrap={false}>
                <View style={styles.cDrug}>
                  <Text>
                    {m.drug}
                    {m.continued ? <Text style={styles.continued}> (continued)</Text> : null}
                  </Text>
                  {m.warnings.length > 0 ? (
                    <Text style={styles.warn}>! {m.warnings[0]}</Text>
                  ) : null}
                </View>
                <Text style={styles.cDose}>
                  {[m.strength, m.dose].filter(Boolean).join(' ') || '—'}
                </Text>
                <Text style={styles.cFreq}>
                  {[m.frequency, m.timing].filter(Boolean).join(' · ') || '—'}
                </Text>
                <Text style={styles.cDur}>{m.durationDays ? `${m.durationDays} days` : '—'}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {rx.investigations.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Investigations</Text>
            {rx.investigations.map((inv, i) => (
              <View key={`${inv.name}-${i}`} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>
                  {inv.name}
                  {inv.rationale ? <Text style={styles.continued}> — {inv.rationale}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {rx.adviceLines.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Advice</Text>
            {rx.adviceLines.map((a, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{a}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {rx.followUp?.when ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Follow-up</Text>
            <Text style={styles.bulletText}>
              {[rx.followUp.when, rx.followUp.withWhat].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}

        <View style={styles.signatureBlock}>
          {props.signedBy && props.signedAt ? (
            <Text>
              Signed by {props.prescriberName} on {formatPdfDateTime(props.signedAt)}
            </Text>
          ) : (
            <Text>Unsigned draft — not a valid prescription.</Text>
          )}
        </View>

        <Text style={styles.footer}>
          Generated via Cureocity Mind. Confidential — handle under DPDP.
        </Text>
      </Page>
    </Document>
  );
}
