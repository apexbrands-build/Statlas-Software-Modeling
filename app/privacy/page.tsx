import type { Metadata } from "next";
import { PublicPage } from "@/components/public/PublicPage";
import { APP_NAME, COMPANY, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: `Privacy policy · ${APP_NAME}` };

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy policy">
      <p>
        Last updated {LEGAL_UPDATED}. {APP_NAME} is data analytics software operated by {COMPANY} (&quot;we&quot;). This policy explains what the app reads
        from a Shopify store, why, and how it is protected.
      </p>

      <h2>Who uses the app</h2>
      <p>
        {APP_NAME} is a read-only analytics platform. Merchants install it to get revenue, ad efficiency and contribution margin reporting in one dashboard.
        Today the dashboard is accessed by signed-in {COMPANY} team members who work with the store. We plan to give store owners direct access to their own store&apos;s dashboard; they would see only their own store&apos;s data.
      </p>

      <h2>Data we read from your store</h2>
      <ul>
        <li>Orders: date, sales channel, tags, gross sales, discounts, shipping charged, taxes, refunds, and line items (variant ID and quantity).</li>
        <li>Customers: Shopify&apos;s numeric customer ID and the number of orders it has placed, only to tell new from returning customers.</li>
        <li>Products: variant ID, SKU, title and cost per item, to calculate cost of goods sold.</li>
        <li>Store details: store name, currency and time zone.</li>
      </ul>
      <p>
        We do <strong>not</strong> request or store customer names, email addresses, phone numbers, or street addresses. We do not read payment details.
      </p>

      <h2>Why we use it</h2>
      <p>
        Only to compute the store&apos;s own performance metrics (revenue, new vs returning revenue, contribution margin) for the merchant and their agency
        team. We do not sell data, share it with advertisers, use it for advertising, or combine it across stores for any purpose other than the agency&apos;s
        own reporting for that store.
      </p>

      <h2>Read-only</h2>
      <p>The app requests read permissions only. It cannot create, edit or delete anything in your store.</p>

      <h2>Where it is stored and how it is protected</h2>
      <p>
        Data is stored in a managed PostgreSQL database (Supabase, United States) with row-level access control, and the application runs on Vercel. Traffic is
        encrypted in transit. The Shopify access token is encrypted at rest (AES-256-GCM) and readable only by our servers.
      </p>

      <h2>Retention and deletion</h2>
      <ul>
        <li>While the app is installed we keep the data above so history stays available for reporting.</li>
        <li>When you uninstall, access stops at once and the token is deleted. When Shopify sends the store erasure request (48 hours after uninstall) we delete the store&apos;s data.</li>
        <li>We honour Shopify&apos;s customer data request and customer erasure requests automatically.</li>
        <li>You can also ask us to delete your data at any time (below). We complete it within 30 days.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR or CCPA) you can ask to access, correct or delete personal information, or object to its processing.
        Because we hold no direct identifiers of your customers, most requests are answered by Shopify&apos;s own tools; we handle anything that reaches us.
      </p>

      <h2>Sub-processors</h2>
      <p>Supabase (database and sign-in) and Vercel (hosting). No data is sent to any other third party.</p>

      <h2>Contact</h2>
      <p>
        Privacy questions or requests: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We may update this policy; the date above shows the latest version.
      </p>
    </PublicPage>
  );
}
