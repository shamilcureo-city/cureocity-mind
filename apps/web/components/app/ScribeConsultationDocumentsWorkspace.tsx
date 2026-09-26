'use client';

import { useScribeConsultationDocuments } from '@/lib/use-scribe-consultation-documents';
import { ScribeConsultationDocumentsPanel } from './ScribeConsultationDocumentsPanel';

/** Server, not the parent view's local signing state, establishes document source authority. */
export function ScribeConsultationDocumentsWorkspace({
  clientId,
  sessionId,
}: {
  clientId: string;
  sessionId: string;
}) {
  const documents = useScribeConsultationDocuments({ clientId, sessionId, enabled: true });
  return (
    <ScribeConsultationDocumentsPanel
      state={documents.state}
      loading={documents.loading}
      busy={documents.busy}
      error={documents.error}
      onReload={() => void documents.reload()}
      onCreate={documents.create}
      onSave={documents.save}
      onDownload={documents.download}
    />
  );
}
