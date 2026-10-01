import Link from "next/link";
import type { ReactNode } from "react";
import { theme } from "@/theme/theme";
import { APP_NAME } from "@/lib/legal";

/** Frame for the pages merchants and Shopify reviewers can open without an Apex account. */
export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-10">
      <header className="mb-10 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={theme.brand.logoIcon} alt="" className="h-10 w-10 rounded-lg" />
        <span className="font-[family-name:var(--font-montserrat)] text-lg font-bold tracking-wide">{APP_NAME}</span>
      </header>
      <main className="flex-1">
        <h1 className="mb-6 font-[family-name:var(--font-montserrat)] text-2xl font-bold">{title}</h1>
        <div className="space-y-4 text-sm leading-relaxed text-text-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text [&_li]:ml-5 [&_li]:list-disc [&_a]:text-accent [&_strong]:text-text">{children}</div>
      </main>
      <footer className="mt-12 flex gap-5 border-t border-border pt-5 text-xs text-text-faint">
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/support">Support</Link>
        <span className="ml-auto">© Apex Brands</span>
      </footer>
    </div>
  );
}
