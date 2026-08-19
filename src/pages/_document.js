import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />

        {/* PWA */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#4f46e5" />

        {/* iOS */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </Head>
      <body className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
