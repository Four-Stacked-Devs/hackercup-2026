import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/components/providers/query-provider';
import { MockProvider } from '@/components/providers/mock-provider';
import { PreferencesProvider } from '@/components/providers/preferences-provider';
import { MaterialProvider } from '@/components/providers/material-provider';
import { AppShell } from '@/components/shell/app-shell';

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'EducLM — one agent, your goals, every step',
  description:
    'An accessible study workspace: turn a module into a lesson, practise with source-grounded feedback, and see the evidence behind every insight.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available: the in-app text scale is an addition to it, never a
  // replacement for it.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      {/* Extensions such as Grammarly stamp attributes on <body> before React
          hydrates; that difference is theirs, not ours. */}
      <body suppressHydrationWarning>
        <MockProvider>
          <QueryProvider>
            <PreferencesProvider>
              <MaterialProvider>
                <AppShell>{children}</AppShell>
              </MaterialProvider>
            </PreferencesProvider>
          </QueryProvider>
        </MockProvider>
      </body>
    </html>
  );
}
