import type { Metadata } from "next";
import "./globals.css";
import { TopBar } from "@/components/layout/TopBar";
import { Toaster } from "@/components/ui/sonner";
import { UpdateReadyToast } from "@/components/desktop/UpdateReadyToast";

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
      <body className="font-sans antialiased">
        <TopBar />
        <main>{children}</main>
        <Toaster />
        <UpdateReadyToast />
      </body>
    </html>
  );
}
