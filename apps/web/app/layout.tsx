import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carddeck",
  description: "Turn a prompt into an editable, exportable deck — with real .pptx export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
