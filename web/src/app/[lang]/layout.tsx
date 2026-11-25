import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Noto_Naskh_Arabic } from "next/font/google";
import { LangProvider } from "@/components/i18n-provider";
import { dirOf } from "@/lib/i18n";
import { getDict, getLang } from "@/lib/i18n-server";
import { LANGUAGES } from "@/lib/types";
import "../globals.css";

// Graphik Arabic (HungerStation's face) is commercial; IBM Plex Sans Arabic is the open
// grotesque closest to it (and carries a Latin set for the English UI). Plex Mono for numbers,
// Naskh serif for quoted source clauses.
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });
const naskh = Noto_Naskh_Arabic({ variable: "--font-naskh", subsets: ["arabic"], weight: ["400", "600"] });

export function generateStaticParams(): { lang: string }[] {
  return LANGUAGES.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "HungerLearn", description: (await getDict()).meta.description };
}

export default async function RootLayout({ children }: LayoutProps<"/[lang]">) {
  const lang = await getLang();
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${plexArabic.variable} ${plexMono.variable} ${naskh.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
