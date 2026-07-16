import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Caveat, Fraunces, IBM_Plex_Mono, Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  // Italic is used by the landing-page display headline; without the real
  // italic file the browser synthesizes a faux oblique that ruins
  // Fraunces' letterforms.
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
});

// Clinical-data register (scores, times, ICD codes) on the landing + app.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

// Hand-written annotations on the landing page only.
const caveat = Caveat({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600'],
  variable: '--font-caveat',
});

export const metadata: Metadata = {
  title: 'Cureocity Mind — AI scribe for your therapy practice',
  description:
    'Record sessions, generate clinical notes, edit by chat, and sign off — without leaving the room.',
};

export const viewport: Viewport = {
  themeColor: '#1D4ED8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${plexMono.variable} ${caveat.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
