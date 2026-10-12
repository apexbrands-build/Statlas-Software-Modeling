"use client";

import { FactsReport } from "./FactsReport";
import { buildNewVsReturning } from "@/lib/reports/new-vs-returning";
import type { GroupBy } from "@/lib/reports/grouping";
import type { ClientSettings, DailyFact } from "@/lib/types";

const build = (facts: DailyFact[], _settings: ClientSettings, by: GroupBy) => buildNewVsReturning(facts, by);

export function NewVsReturningReport() {
  return <FactsReport slug="new-vs-returning" firstLabel="Date" caption="Orders by new vs retained customers (new = first paid order of the customer)" build={build} />;
}
