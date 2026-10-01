import { ReportRouter } from "@/components/reports/ReportRouter";

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ReportRouter slug={slug} />;
}
