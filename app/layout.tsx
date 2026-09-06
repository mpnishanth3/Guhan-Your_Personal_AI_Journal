import type { Metadata } from 'next';
import './globals.css';
import Script from 'next/script';
import { AntigravityBackground } from '@/components/AntigravityBackground';
import { BackgroundProcessProvider } from '@/context/BackgroundProcessContext';
import { GlobalBackgroundProcessIndicator } from '@/components/GlobalBackgroundProcessIndicator';

export const metadata: Metadata = {
  title: 'Guhan Powered by Gemini',
  description: 'A secure, user-authenticated journaling app powered by Gemini and Cloud Firestore.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'Guhan Powered by Gemini',
    description: 'A secure, user-authenticated journaling app powered by Gemini and Cloud Firestore.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Guhan Powered by Gemini',
    description: 'A secure, user-authenticated journaling app powered by Gemini and Cloud Firestore.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body suppressHydrationWarning className="bg-[#050505] text-slate-100 antialiased min-h-screen">
        <Script
          id="fix-fetch"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && window.fetch) {
                const originalFetch = window.fetch;
                try {
                  Object.defineProperty(window, 'fetch', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: originalFetch
                  });
                } catch (e) {
                  console.error('Failed to redefine window.fetch:', e);
                  try {
                    delete window.fetch;
                    window.fetch = originalFetch;
                  } catch (e2) {
                    console.error('Failed to delete window.fetch:', e2);
                  }
                }
              }
            `,
          }}
        />
        <BackgroundProcessProvider>
          <AntigravityBackground />
          <div suppressHydrationWarning className="w-full min-h-screen relative z-10 bg-transparent">
            {children}
          </div>
          <GlobalBackgroundProcessIndicator />
        </BackgroundProcessProvider>
      </body>
    </html>
  );
}