import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Builder Sales Bot Admin",
  description: "Backoffice для каталога, лидов и базы знаний застройщика."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
