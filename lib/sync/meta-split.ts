export interface DayRow {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  purchases: number;
  revenue: number;
}

export interface Totals3 {
  spend: number;
  purchases: number;
  revenue: number;
}

export interface SpendRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  category: "acquisition" | "retention";
  audience_type: "new" | "returning";
  spend: number;
  platform_revenue: number;
  platform_purchases: number;
}

/**
 * Splits each campaign-day into acquisition and existing-customer rows.
 * Acquisition = campaign total minus existing-customer amounts, so totals always match Meta's overall numbers.
 * Existing rows get a ":existing" suffix on the campaign id.
 */
export function splitCampaignDays(days: DayRow[], existing: Map<string, Totals3>): SpendRow[] {
  const out: SpendRow[] = [];
  for (const c of days) {
    const ex = existing.get(`${c.date}|${c.campaignId}`);
    const acq = ex
      ? { spend: Math.max(0, c.spend - ex.spend), revenue: Math.max(0, c.revenue - ex.revenue), purchases: Math.max(0, c.purchases - ex.purchases) }
      : { spend: c.spend, revenue: c.revenue, purchases: c.purchases };
    if (acq.spend > 0 || acq.purchases > 0) {
      out.push({ date: c.date, campaign_id: c.campaignId, campaign_name: c.campaignName, category: "acquisition", audience_type: "new", spend: acq.spend, platform_revenue: acq.revenue, platform_purchases: acq.purchases });
    }
    if (ex && (ex.spend > 0 || ex.purchases > 0)) {
      out.push({ date: c.date, campaign_id: `${c.campaignId}:existing`, campaign_name: c.campaignName, category: "retention", audience_type: "returning", spend: ex.spend, platform_revenue: ex.revenue, platform_purchases: ex.purchases });
    }
  }
  return out;
}
