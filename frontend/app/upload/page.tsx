'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUploadDialog } from '@/components/upload/upload-dialog';

/**
 * Add material lives in a modal now. This route survives only so old links
 * and bookmarks still work: it opens the dialog over the home screen.
 */
export default function UploadPage() {
  const router = useRouter();
  const { openUpload } = useUploadDialog();

  useEffect(() => {
    openUpload();
    router.replace('/');
  }, [openUpload, router]);

  return null;
}
