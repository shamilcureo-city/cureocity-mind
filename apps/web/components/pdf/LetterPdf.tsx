import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfDate } from '@/lib/doc-format';

/**
 * Sprint 66 — a formal therapist letter (referral / supporting).
 *
 * Letterhead with the therapist's name + RCI registration, the date, the
 * addressee and a subject line, then the composed body, then a signature
 * block. Pure: the route supplies all text. Same austere print style as
 * the other PDFs.
 */
export interface LetterPdfProps {
  therapistName: string;
  rciNumber: string;
  recipient: string;
  subject: string;
  /** Body paragraphs joined by blank lines. */
  body: string;
  generatedAt: string;
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
    marginBottom: 18,
  },
  name: { fontSize: 14, fontFamily: 'Times-Roman' },
  credential: { fontSize: 9, color: '#5a5a60', marginTop: 2 },
  date: { fontSize: 10, color: '#5a5a60', marginBottom: 14, textAlign: 'right' },
  addressee: { fontSize: 11, marginBottom: 12 },
  subject: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 14 },
  para: { fontSize: 11, marginBottom: 10 },
  signature: { marginTop: 26 },
  signName: { fontSize: 11, fontFamily: 'Times-Roman' },
  signCred: { fontSize: 9, color: '#5a5a60', marginTop: 2 },
  footer: {
    marginTop: 30,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    fontSize: 8,
    color: '#888889',
  },
});

export function LetterPdf(props: LetterPdfProps) {
  const paragraphs = props.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const dateStr = formatPdfDate(props.generatedAt, { month: 'long' });
  return (
    <Document
      title={`Letter — ${props.subject}`}
      author={props.therapistName}
      creator="Cureocity Mind"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.letterhead}>
          <Text style={styles.name}>{props.therapistName}</Text>
          <Text style={styles.credential}>Psychologist · RCI {props.rciNumber}</Text>
        </View>

        <Text style={styles.date}>{dateStr}</Text>

        <Text style={styles.addressee}>To: {props.recipient}</Text>
        <Text style={styles.subject}>Re: {props.subject}</Text>

        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.para}>
            {p}
          </Text>
        ))}

        <View style={styles.signature}>
          <Text style={styles.signName}>{props.therapistName}</Text>
          <Text style={styles.signCred}>RCI {props.rciNumber}</Text>
        </View>

        <Text style={styles.footer}>
          Generated via Cureocity Mind. Confidential — handle under DPDP.
        </Text>
      </Page>
    </Document>
  );
}
