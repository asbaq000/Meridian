import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'Meridian — scheduling across timezones',
  description:
    'Book appointments across timezones without anyone doing arithmetic. Every time is shown in both clocks.',
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning covers attributes injected into <html> and
    // <body> by browser extensions before React loads - Bitdefender's
    // `bis_skin_checked`, Liner's `data-liner-extension-version`, and similar.
    // React cannot reconcile markup it did not render, and there is nothing to
    // fix in the page. It suppresses one level only, so a genuine mismatch in
    // the app's own tree still reports normally.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-rule px-4 py-6 sm:px-6">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate">
                <span className="font-mono tracking-[0.14em] uppercase">Meridian</span>
                <span>All times stored in UTC. Nothing is ever displayed without its zone.</span>
              </div>
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
