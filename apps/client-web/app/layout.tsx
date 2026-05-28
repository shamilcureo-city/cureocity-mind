import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Cureocity Mind — Client',
  description: 'Your between-session companion',
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
  // PRD calls out iOS Safari needs PWA install — viewport-fit=cover lets
  // the manifest's display: standalone respect notches when installed.
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
