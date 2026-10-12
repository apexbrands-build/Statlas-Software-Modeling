export type ReportCategory = "Recommended" | "Visitor" | "Conversion" | "LTV" | "Costs" | "Revenue";
export const CATEGORIES: (ReportCategory | "All")[] = ["Recommended", "Visitor", "Conversion", "LTV", "Costs", "Revenue", "All"];

/** ready = the page is built (ReportRouter has a case for it); waiting = page and layout built, data source not connected yet; planned = no page yet ("Coming soon"). */
export type ReportStatus = "ready" | "waiting" | "planned";

export interface ReportDef {
  slug: string;
  title: string;
  description: string;
  categories: ReportCategory[];
  status: ReportStatus;
  /** Shown on waiting reports: what is missing. */
  needs?: string;
}

/** Build order of the library (the Recommended reports first, then the LTV reports). */
export const REPORTS: ReportDef[] = [
  { slug: "mer", title: "Marketing Efficiency Report", description: "Marketing Efficiency Rating (MER), profitability, and other important business metrics", categories: ["Recommended", "Revenue"], status: "ready" },
  { slug: "pnl", title: "P&L", description: "Profit and Loss Statement", categories: ["Recommended", "Revenue"], status: "ready" },
  { slug: "contribution-margin", title: "Contribution Margin", description: "Contribution margin analysis from gross sales to contribution margin, by day, week or month", categories: ["Recommended", "Costs", "Revenue"], status: "ready" },
  { slug: "revenue-overview", title: "Revenue Overview", description: "Revenue, refunds and number of orders", categories: ["Revenue"], status: "ready" },
  { slug: "ads", title: "Paid Media Overview", description: "All advertising reports in one place.", categories: ["Recommended", "Visitor"], status: "ready" },
  { slug: "facebook-tracker", title: "Facebook Trackers", description: "Day-by-day spend and iROAS pacing per campaign", categories: ["Recommended", "Visitor"], status: "planned" },
  { slug: "google-tracker", title: "Google Trackers", description: "Day-by-day spend and iROAS pacing per campaign", categories: ["Recommended", "Visitor"], status: "planned" },
  { slug: "first-product", title: "Product by First Product", description: "What customers do after a first order containing each product: repeat orders, order value and refunds", categories: ["LTV"], status: "ready" },
  { slug: "aov-histogram", title: "AOV Histogram", description: "Distribution of order values with mean, median and mode", categories: ["Conversion"], status: "ready" },
  { slug: "total-net-customer", title: "Total Net Customer", description: "Groups the activity of each customer since store inception to display customer growth over time", categories: ["Recommended", "Revenue"], status: "planned" },
  { slug: "variable-costs", title: "Variable Costs Dashboard", description: "Variable costs reporting", categories: ["Recommended", "Costs"], status: "planned" },
  { slug: "calendar", title: "Calendar Report", description: "Key business metrics overlaid with events and goals", categories: ["Recommended"], status: "planned" },
  { slug: "hourly", title: "Hourly Report", description: "Hour by hour data report", categories: ["Recommended", "Revenue"], status: "waiting", needs: "Hourly order and spend data (not stored yet)" },
  { slug: "email-metrics", title: "Email Metrics Report", description: "Email metrics between different applicable sources", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Klaviyo connection" },
  { slug: "email-tracker", title: "Email Trackers", description: "Email tracker (Klaviyo)", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Klaviyo connection" },
  { slug: "sms-tracker", title: "SMS Trackers", description: "SMS tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Klaviyo SMS connection" },
  { slug: "pinterest-tracker", title: "Pinterest Trackers", description: "Pinterest tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Pinterest connection" },
  { slug: "tiktok-tracker", title: "TikTok Trackers", description: "TikTok tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "TikTok connection" },
  { slug: "snapchat-tracker", title: "Snapchat Trackers", description: "Snapchat tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Snapchat connection" },
  { slug: "bing-tracker", title: "Bing Trackers", description: "Bing tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "Bing Ads connection" },
  { slug: "youtube-tracker", title: "YouTube Trackers", description: "YouTube tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "YouTube connection" },
  { slug: "applovin-tracker", title: "AppLovin Trackers", description: "AppLovin tracker", categories: ["Recommended", "Visitor"], status: "waiting", needs: "AppLovin connection" },
  { slug: "ltv-dashboard", title: "LTV Dashboard", description: "LTV metrics with net active customer and 60 day LTV charts", categories: ["LTV"], status: "planned" },
  { slug: "revenue-over-time", title: "Revenue Over Time", description: "Number of new customers each month and their revenue by period of days from the first order", categories: ["LTV"], status: "planned" },
  { slug: "net-active-customers", title: "Net Active Customer Detail", description: "Path of the customers acquired in the date range: new, returning, reactivated, at risk, churned", categories: ["LTV"], status: "planned" },
  { slug: "new-vs-returning", title: "New Vs Returning Overview", description: "Orders by new vs retained cohorts (based on first-order date)", categories: ["LTV"], status: "ready" },
];

export const getReport = (slug: string) => REPORTS.find((r) => r.slug === slug);
