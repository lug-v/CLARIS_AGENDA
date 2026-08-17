import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clari — sua agenda inteligente",
  description: "Transforme voz, foto ou texto em compromissos organizados.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
