import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "InfraReport", template: "%s · InfraReport" },
  description: "Electrical infrared inspection management and reporting. Prototype build with fictional demonstration data.",
  robots: { index: false, follow: false },
  applicationName: "InfraReport",
  appleWebApp: { capable: true, title: "InfraReport", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#0f172a", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
