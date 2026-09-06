export function transcriptIsProcessing(status: string): boolean {
  return status === 'PENDING' || status === 'IN_PROGRESS';
}
