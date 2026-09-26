'use client';

import { useScribeDoctorTemplates } from '@/lib/use-scribe-doctor-templates';
import { ScribeDoctorTemplatesPanel } from './ScribeDoctorTemplatesPanel';

export function ScribeDoctorTemplatesWorkspace() {
  const settings = useScribeDoctorTemplates(true);
  return <ScribeDoctorTemplatesPanel settings={settings} />;
}
