import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "scriptr",
  description: "Local-first writer for AI-assisted short stories.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
