import type { Metadata } from "next";
import { Bitter, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE_PATH, OG_IMAGE_SIZE, SITE_NAME, getSiteUrl } from "./share-metadata";
import "./globals.css";

const headingFont = Bitter({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  applicationName: SITE_NAME,
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "fi_FI",
    type: "website",
    images: [
      {
        url: DEFAULT_OG_IMAGE_PATH,
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        alt: "Niilo22 Search preview image",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE_PATH],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="fi">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
