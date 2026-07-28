import { PracticeScreen } from '@/components/practice/practice-screen';

export default async function PracticeSetPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  return <PracticeScreen setId={setId} />;
}
