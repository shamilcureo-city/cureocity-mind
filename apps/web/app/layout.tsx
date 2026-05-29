import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Cureocity Mind',
  description: 'Ambient therapy scribe and between-session companion',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cureocity Mind',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f3a5f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
