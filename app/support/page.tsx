import type { Metadata } from "next";
import { PublicPage } from "@/components/public/PublicPage";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: `Support · ${APP_NAME}` };

export default function SupportPage() {
  return (
    <PublicPage title="Support">
      <p>
        Questions about {APP_NAME}, what it reads from your store, or how to remove it? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We answer within one business day (Monday to Friday).
      </p>
      <h2>Uninstall the app</h2>
      <p>
        In your Shopify admin go to <strong>Settings → Apps and sales channels</strong>, open {APP_NAME} and choose <strong>Uninstall</strong>. Access stops
        immediately and we delete the stored access token. Shopify then tells us to erase the store&apos;s data, which we do within 30 days.
      </p>
      <h2>Ask us to delete or export your data</h2>
      <p>Email us from the address on the Shopify account. We confirm and complete deletion within 30 days.</p>
      <h2>What the app does</h2>
      <p>
        {APP_NAME} reads orders, refunds, shipping, taxes and product costs to report revenue and contribution margin. It never
        changes anything in your store. Details are in the <a href="/privacy">privacy policy</a>.
      </p>
    </PublicPage>
  );
}
