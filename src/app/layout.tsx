import type { Metadata } from 'next';
import { Roboto } from 'next/font/google'; // Import Roboto
import './globals.css';
import { Toaster } from '@/components/ui/toaster'; // Import Toaster

const roboto = Roboto({
  weight: ['400', '500', '700'], // Specify weights needed
  subsets: ['latin'],
  variable: '--font-roboto', // Assign CSS variable
});

export const metadata: Metadata = {
  title: 'Playwright to Robot Converter',
  description: 'Convert Playwright Python scripts to Robot Framework test cases.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Apply 'dark' class directly to html for permanent dark mode
    // Removed suppressHydrationWarning as ThemeProvider is removed
    <html lang="en" className="dark">
      <body className={`${roboto.variable} antialiased`}>
        {' '}
        {/* Apply font variable and fallback */}
        {/* ThemeProvider removed */}
        {children}
        <Toaster /> {/* Add Toaster component here */}
      </body>
    </html>
  );
}
