'use client';

import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SectionHeading } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import {
  ChevronRight,
  DocIcon,
  HelpIcon,
  LibraryIcon,
  PlanIcon,
  SettingsIcon,
  UploadIcon,
} from '@/components/ui/icons';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { EduMascot } from '@/components/brand/edu-mascot';

interface Row {
  key: string;
  label: string;
  detail?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string | null;
  unavailableReason?: string;
}

/**
 * The fifth phone tab. Everything the rail shows on desktop that does not fit
 * four thumbs, in one scannable list.
 */
export function MoreView() {
  const { material, materials } = useCurrentMaterial();

  const workspace: Row[] = [
    {
      key: 'plan',
      label: 'Learning plan',
      detail: material ? material.title : 'Add a material first',
      icon: PlanIcon,
      href: material ? `/plan/${material.id}` : null,
      ...(material ? {} : { unavailableReason: 'Add a material to build a plan.' }),
    },
    {
      key: 'library',
      label: 'Library',
      detail: `${materials.length} material${materials.length === 1 ? '' : 's'} on this device`,
      icon: LibraryIcon,
      href: '/materials',
    },
    {
      key: 'upload',
      label: 'Add material',
      detail: 'One PDF, up to 20 MB',
      icon: UploadIcon,
      href: '/upload',
    },
    {
      key: 'source',
      label: 'Read the material',
      detail: material ? `${material.pageCount ?? 0} pages` : 'Add a material first',
      icon: DocIcon,
      href: material ? `/study/${material.id}` : null,
      ...(material ? {} : { unavailableReason: 'Add a material to read it.' }),
    },
  ];

  const settings: Row[] = [
    {
      key: 'settings',
      label: 'Settings',
      detail: 'Reading, motion and your data',
      icon: SettingsIcon,
      href: '/settings',
    },
    {
      key: 'ai',
      label: 'How EducLM uses AI',
      detail: 'Models, libraries and limits',
      icon: HelpIcon,
      href: '/about/ai-use',
    },
  ];

  return (
    <>
      <WorkspaceHeader title="More" subtitle="Everything else in your workspace" />

      <div className="mx-auto w-full max-w-2xl flex-1 px-3 py-4 sm:px-5">
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <EduMascot size={48} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">EducLM works from your own material</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Nothing here is generic content — every lesson, question and finding comes from what
              you uploaded.
            </p>
          </div>
        </div>

        <SectionHeading title="Workspace" />
        <RowList rows={workspace} />

        <SectionHeading title="Settings" className="mt-5" />
        <RowList rows={settings} />
      </div>
    </>
  );
}

function RowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((row) => {
        const Icon = row.icon;

        const body = (
          <>
            <Icon className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{row.label}</span>
              {row.detail ? (
                <span className="block truncate text-xs text-ink-muted">{row.detail}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li key={row.key} className="border-b border-line last:border-0">
            {row.href ? (
              <Link
                href={row.href}
                prefetch={false}
                className="flex min-h-12 items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken"
              >
                {body}
                <ChevronRight className="shrink-0 text-ink-subtle" />
              </Link>
            ) : (
              <span
                title={row.unavailableReason}
                className="flex min-h-12 items-center gap-3 px-3 py-2.5 opacity-60"
              >
                {body}
                <Chip tone="neutral">Unavailable</Chip>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
