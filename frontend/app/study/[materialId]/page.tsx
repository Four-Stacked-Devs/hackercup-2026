import { Suspense } from 'react';
import { StudyView } from '@/components/study/study-view';

export default async function StudyPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;

  return (
    <Suspense fallback={null}>
      <StudyView materialId={materialId} />
    </Suspense>
  );
}
