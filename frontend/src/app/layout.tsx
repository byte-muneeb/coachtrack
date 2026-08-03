import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoachTrack Pro — Management Suite",
  description:
    "Coaching-center management for Pakistan: fees, vouchers, attendance, tests, and parent communication.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="light h-full antialiased">
      <head>
        {/* Fonts + Material Symbols — matches the Stitch design system */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* display=block (not swap): keep the icon slot blank until the glyph
            loads, so raw ligature text like "delete"/"payments" never flashes. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-background text-on-surface">{children}</body>
    </html>
  );
}
