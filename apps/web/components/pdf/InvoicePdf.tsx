import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { GST_RATE, SAC_CODE, type GstBreakdown, type SellerIdentity } from '@/lib/invoice';

/**
 * Sprint 56 (Lever 4 #3) — GST tax invoice for a paid subscription.
 * @react-pdf/renderer (no Chromium needed on Vercel), austere layout to
 * match the signed-note PDF.
 */
export interface InvoicePdfProps {
  invoiceNumber: string;
  invoiceDate: string;
  paymentRef: string;
  seller: SellerIdentity;
  buyer: { name: string; email: string };
  lineDescription: string;
  gst: GstBreakdown;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1c1c1e',
    backgroundColor: '#ffffff',
  },
  title: { fontSize: 20, fontFamily: 'Times-Roman', marginBottom: 2 },
  kicker: { fontSize: 9, color: '#5a5a60', textTransform: 'uppercase', letterSpacing: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  seller: { maxWidth: 260 },
  metaBox: { textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: '#5a5a60' },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 16 },
  block: { maxWidth: 250 },
  blockHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#5a5a60',
    marginBottom: 3,
  },
  table: { marginTop: 8, borderWidth: 1, borderColor: '#d4d0c8' },
  thead: {
    flexDirection: 'row',
    backgroundColor: '#f4f2ec',
    borderBottomWidth: 1,
    borderBottomColor: '#d4d0c8',
  },
  trow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eceae3' },
  th: { padding: 6, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  td: { padding: 6, fontSize: 9 },
  cDesc: { width: '46%' },
  cSac: { width: '14%' },
  cQty: { width: '8%', textAlign: 'right' },
  cAmt: { width: '32%', textAlign: 'right' },
  totals: { marginTop: 10, marginLeft: 'auto', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#d4d0c8',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: '#888889',
    borderTopWidth: 1,
    borderTopColor: '#eceae3',
    paddingTop: 8,
  },
});

function inr(n: number): string {
  return `INR ${n.toLocaleString('en-IN')}`;
}

export function InvoicePdf(props: InvoicePdfProps) {
  const { seller, buyer, gst } = props;
  return (
    <Document
      title={`Invoice ${props.invoiceNumber}`}
      author={seller.legalName}
      subject="Tax invoice"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.seller}>
            <Text style={styles.title}>{seller.legalName}</Text>
            <Text style={styles.muted}>{seller.address}</Text>
            <Text style={styles.muted}>State: {seller.state}</Text>
            {seller.gstin && <Text style={styles.muted}>GSTIN: {seller.gstin}</Text>}
            <Text style={styles.muted}>{seller.email}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.kicker}>Tax Invoice</Text>
            <Text style={[styles.bold, { marginTop: 4 }]}>{props.invoiceNumber}</Text>
            <Text style={styles.muted}>Date: {props.invoiceDate}</Text>
            <Text style={styles.muted}>Payment: {props.paymentRef}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.block}>
            <Text style={styles.blockHeading}>Billed to</Text>
            <Text style={styles.bold}>{buyer.name}</Text>
            <Text style={styles.muted}>{buyer.email}</Text>
          </View>
          <View style={styles.block}>
            <Text style={styles.blockHeading}>Supply</Text>
            <Text style={styles.muted}>Subscription — SaaS (SAC {SAC_CODE})</Text>
            <Text style={styles.muted}>Reverse charge: No</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cSac]}>SAC</Text>
            <Text style={[styles.th, styles.cQty]}>Qty</Text>
            <Text style={[styles.th, styles.cAmt]}>Taxable value</Text>
          </View>
          <View style={styles.trow}>
            <Text style={[styles.td, styles.cDesc]}>{props.lineDescription}</Text>
            <Text style={[styles.td, styles.cSac]}>{SAC_CODE}</Text>
            <Text style={[styles.td, styles.cQty]}>1</Text>
            <Text style={[styles.td, styles.cAmt]}>{inr(gst.baseInr)}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Taxable value</Text>
            <Text>{inr(gst.baseInr)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>IGST @ {Math.round(GST_RATE * 100)}%</Text>
            <Text>{inr(gst.igstInr)}</Text>
          </View>
          <View style={styles.grand}>
            <Text>Total paid</Text>
            <Text>{inr(gst.grossInr)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          This is a computer-generated tax invoice and does not require a signature. Amounts are in
          Indian Rupees and were charged GST-inclusive. {!seller.gstin && '(GSTIN pending — '}
          {!seller.gstin && 'provisional invoice.)'}
        </Text>
      </Page>
    </Document>
  );
}
