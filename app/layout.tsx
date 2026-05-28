import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blissful Catholic",
  description:
    "An AI Catholic spiritual companion — daily readings, prayer, and a personalized walk in the faith.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
