import { PlanEditor } from "@/components/planning/PlanEditor";

export default async function PlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <PlanEditor planId={planId} />;
}
