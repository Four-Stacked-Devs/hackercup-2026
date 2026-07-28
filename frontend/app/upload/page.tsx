import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { UploadView } from '@/components/upload/upload-view';

export default function UploadPage() {
  return (
    <>
      <WorkspaceHeader
        title="Add material"
        subtitle="One PDF becomes a lesson, a plan and a question bank."
        backHref="/"
        backLabel="Agent"
        showStatus={false}
      />
      <div className="mx-auto w-full max-w-2xl flex-1 px-3 py-5 sm:px-5">
        <UploadView />
      </div>
    </>
  );
}
