import { ProgressScreen } from '@/components/progress/progress-screen';

export default async function ProgressPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  return <ProgressScreen materialId={materialId} />;
}
