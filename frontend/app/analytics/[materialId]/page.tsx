import { AnalyticsScreen } from '@/components/analytics/analytics-screen';

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  return <AnalyticsScreen materialId={materialId} />;
}
