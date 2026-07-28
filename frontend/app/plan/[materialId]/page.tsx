import { PlanScreen } from '@/components/plan/plan-screen';

export default async function PlanPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  return <PlanScreen materialId={materialId} />;
}
