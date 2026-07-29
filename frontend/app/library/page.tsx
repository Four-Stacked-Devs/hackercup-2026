import { redirect } from 'next/navigation';

/** The library is now Course Explorer. Old links and bookmarks still land. */
export default function LibraryPage() {
  redirect('/materials');
}
