import type { Metadata } from "next";
import "./globals.css";
import { TopBar } from "@/components/layout/TopBar";
import { Toaster } from "@/components/ui/sonner";
import { UpdateReadyToast } from "@/components/desktop/UpdateReadyToast";
import { ThemeProvider } from "@/components/theme-provider";

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
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <TopBar />
          <main>{children}</main>
          <Toaster />
          <UpdateReadyToast />
        </ThemeProvider>
      </body>
    </html>
  );
}
