'use client';

import type { ComponentType, SVGProps } from 'react';
import {
  BookIcon,
  ChatIcon,
  GridIcon,
  HomeIcon,
  LibraryIcon,
  MenuIcon,
  PlanIcon,
  PracticeIcon,
  ProgressIcon,
} from '@/components/ui/icons';

export interface NavItem {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** null when nothing in this build backs it. */
  href: string | null;
  /** Why it is unavailable, shown on hover and to screen readers. */
  unavailableReason?: string;
}

/**
 * The desktop rail. Items the API cannot back are kept in place and disabled
 * rather than quietly removed — the shape of the product stays legible, and
 * nothing on screen pretends to work.
 */
export function railNav(materialId: string | null): NavItem[] {
  return [
    { key: 'home', label: 'Home', icon: HomeIcon, href: '/' },
    {
      key: 'conversations',
      label: 'Conversations',
      icon: ChatIcon,
      href: null,
      unavailableReason:
        'One conversation per material in this build — the API keeps a single thread.',
    },
    {
      key: 'learn',
      label: 'Learn',
      icon: BookIcon,
      href: materialId ? `/study/${materialId}` : '/library',
    },
    {
      key: 'plan',
      label: 'Learning plan',
      icon: PlanIcon,
      href: materialId ? `/plan/${materialId}` : null,
      ...(materialId ? {} : { unavailableReason: 'Add a material to build a plan.' }),
    },
    { key: 'practice', label: 'Practice', icon: PracticeIcon, href: '/practice' },
    {
      key: 'progress',
      label: 'Progress',
      icon: ProgressIcon,
      href: materialId ? `/progress/${materialId}` : null,
      ...(materialId ? {} : { unavailableReason: 'Add a material to see progress.' }),
    },
    { key: 'library', label: 'Library', icon: LibraryIcon, href: '/library' },
  ];
}

/**
 * The five phone tabs. Learn opens the material you are reading; More holds the
 * plan, the library and settings, so the bar stays at five.
 */
export function mobileTabs(materialId: string | null): NavItem[] {
  return [
    { key: 'home', label: 'Home', icon: HomeIcon, href: '/' },
    {
      key: 'learn',
      label: 'Learn',
      icon: BookIcon,
      href: materialId ? `/study/${materialId}` : '/library',
    },
    { key: 'practice', label: 'Practice', icon: GridIcon, href: '/practice' },
    {
      key: 'progress',
      label: 'Progress',
      icon: ProgressIcon,
      href: materialId ? `/progress/${materialId}` : '/library',
    },
    { key: 'more', label: 'More', icon: MenuIcon, href: '/more' },
  ];
}
