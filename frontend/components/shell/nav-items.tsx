'use client';

import type { ComponentType, SVGProps } from 'react';
import {
  AnalyticsIcon,
  ChatIcon,
  CompassIcon,
  GridIcon,
  PlanIcon,
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
 * The rail.
 *
 * Four destinations under the New Chat action, matching the product mockups:
 * Explorer, Plan, Analytics, Progress. Settings is reachable from the account
 * row and the header's display popover, so it does not take a rail slot.
 *
 * The reader, the practice runner and the source viewer are deliberately not
 * here. They open from a conversation, a plan step or a material card, so they
 * arrive with the context that sent you there.
 */
export function railNav(materialId: string | null): NavItem[] {
  return [
    { key: 'explorer', label: 'Course Explorer', icon: CompassIcon, href: '/materials' },
    {
      key: 'plan',
      label: 'Learning Plan',
      icon: PlanIcon,
      href: materialId ? `/plan/${materialId}` : null,
      ...(materialId ? {} : { unavailableReason: 'Add a material to build a plan.' }),
    },
    {
      key: 'analytics',
      label: 'Analytics',
      icon: AnalyticsIcon,
      href: materialId ? `/analytics/${materialId}` : null,
      ...(materialId ? {} : { unavailableReason: 'Add a material to see analytics.' }),
    },
    {
      key: 'progress',
      label: 'Progress',
      icon: ProgressIcon,
      href: materialId ? `/progress/${materialId}` : null,
      ...(materialId ? {} : { unavailableReason: 'Add a material to see progress.' }),
    },
  ];
}

/**
 * The five phone tabs, matching the mockups: Home, Explore, Plan, Analytics,
 * Progress. Settings and About are reached through the account row and the
 * header popover instead of a tab.
 */
export function mobileTabs(materialId: string | null): NavItem[] {
  return [
    { key: 'chat', label: 'Home', icon: ChatIcon, href: '/' },
    { key: 'explorer', label: 'Explore', icon: GridIcon, href: '/materials' },
    {
      key: 'plan',
      label: 'Plan',
      icon: PlanIcon,
      href: materialId ? `/plan/${materialId}` : '/materials',
    },
    {
      key: 'analytics',
      label: 'Analytics',
      icon: AnalyticsIcon,
      href: materialId ? `/analytics/${materialId}` : '/materials',
    },
    {
      key: 'progress',
      label: 'Progress',
      icon: ProgressIcon,
      href: materialId ? `/progress/${materialId}` : '/materials',
    },
  ];
}
