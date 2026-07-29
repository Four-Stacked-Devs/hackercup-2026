'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { AccessibilityPreferences } from '@educlm/contracts';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/sheet';
import { ErrorState } from '@/components/ui/states';
import { usePreferences } from '@/components/providers/preferences-provider';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useDeleteMaterial } from '@/lib/hooks/use-materials';
import { resetDeviceId } from '@/lib/device';
import { API_MODE } from '@/lib/config';
import { cn } from '@/lib/cn';

/** Everything in the reading toolbar, plus the controls over your own data. */
export function SettingsView() {
  const { preferences, update, saveError } = usePreferences();
  const { materials } = useCurrentMaterial();
  const remove = useDeleteMaterial();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDevice, setConfirmDevice] = useState(false);

  return (
    <>
      <WorkspaceHeader
        title="Settings"
        subtitle="Reading, motion and your data"
        backHref="/"
        backLabel="Agent"
        showStatus={false}
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-5 sm:px-5">
        <ProfileCard />

        <Card>
          <CardHeader
            title="Reading"
            description="These apply everywhere, immediately, and are saved to this device."
          />

          <SettingRow label="Text size" hint="Everything on screen scales with this.">
            <ChoiceGroup
              name="fontScale"
              value={String(preferences.fontScale)}
              options={[1, 1.25, 1.5, 1.75].map((scale) => ({
                value: String(scale),
                label: `${scale}×`,
              }))}
              onChange={(value) =>
                update({ fontScale: Number(value) as AccessibilityPreferences['fontScale'] })
              }
            />
          </SettingRow>

          <SettingRow label="Line spacing" hint="More space between lines can make long text easier to follow.">
            <ChoiceGroup
              name="lineSpacing"
              value={preferences.lineSpacing}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'relaxed', label: 'Relaxed' },
                { value: 'loose', label: 'Loose' },
              ]}
              onChange={(value) =>
                update({ lineSpacing: value as AccessibilityPreferences['lineSpacing'] })
              }
            />
          </SettingRow>

          <ToggleRow
            label="High contrast"
            hint="Black text on white, heavier borders, stronger focus outlines."
            checked={preferences.highContrast}
            onChange={(checked) => update({ highContrast: checked })}
          />

          <ToggleRow
            label="Wider-spaced font"
            hint="Swaps the type for a face with more space between letters."
            checked={preferences.readableFont}
            onChange={(checked) => update({ readableFont: checked })}
          />
        </Card>

        <Card>
          <CardHeader title="Read aloud" />

          <ToggleRow
            label="Show read-aloud controls"
            hint="Adds a play control to each lesson section, and highlights the sentence being read."
            checked={preferences.readAloud.enabled}
            onChange={(checked) => update({ readAloud: { enabled: checked } })}
          />

          <SettingRow label="Reading speed">
            <ChoiceGroup
              name="rate"
              value={String(preferences.readAloud.rate)}
              options={[0.75, 1, 1.25, 1.5].map((rate) => ({
                value: String(rate),
                label: `${rate}×`,
              }))}
              onChange={(value) =>
                update({
                  readAloud: {
                    rate: Number(value) as AccessibilityPreferences['readAloud']['rate'],
                  },
                })
              }
            />
          </SettingRow>
        </Card>

        <Card>
          <CardHeader title="Motion and data" />

          <ToggleRow
            label="Reduce motion"
            hint="Turns off sheet and panel animation. Your device setting is respected too."
            checked={preferences.reducedMotion}
            onChange={(checked) => update({ reducedMotion: checked })}
          />

          <ToggleRow
            label="Low data mode"
            hint="Skips page images and background loading. Text-only source view."
            checked={preferences.lowDataMode}
            onChange={(checked) => update({ lowDataMode: checked })}
          />
        </Card>

        {saveError ? <ErrorState error={new Error(saveError)} /> : null}

        <Card>
          <CardHeader
            title="Your data"
            description="EducLM keeps your work against an anonymous device id. There is no account."
          />

          <div className="flex flex-wrap gap-2">
            <ButtonLink variant="outline" href="/materials">
              Delete a single material
            </ButtonLink>
            <Button
              variant="danger"
              onClick={() => setConfirmAll(true)}
              disabled={materials.length === 0 || remove.isPending}
            >
              Delete everything
            </Button>
            <Button variant="ghost" className="text-ink-muted" onClick={() => setConfirmDevice(true)}>
              Start a fresh device session
            </Button>
          </div>

          {remove.isError ? <ErrorState className="mt-3" error={remove.error} /> : null}

          <p className="mt-3 text-xs text-ink-muted">
            Running in {API_MODE} mode.{' '}
            {API_MODE === 'mock'
              ? 'Nothing leaves this browser: the API is being simulated.'
              : 'Requests go to the EducLM API.'}
          </p>
        </Card>

        <Card>
          <CardHeader
            title="About"
            description="What EducLM runs on, and where AI is involved."
          />
          <ButtonLink variant="outline" href="/about/ai-use">
            How EducLM uses AI
          </ButtonLink>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Delete everything?"
        body="Every material, lesson, question, answer and finding on this device is removed. This cannot be undone."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => {
          materials.forEach((entry) => remove.mutate(entry.id));
        }}
      />

      <ConfirmDialog
        open={confirmDevice}
        onOpenChange={setConfirmDevice}
        title="Start a fresh device session?"
        body="EducLM will treat this browser as a new student. Your existing work stays on the old session but you will not see it here."
        confirmLabel="Start fresh"
        onConfirm={() => {
          resetDeviceId();
          queryClient.clear();
          router.push('/');
        }}
      />
    </>
  );
}

/**
 * Who this session belongs to. The API keys everything to an anonymous device
 * id and has no endpoint to set a name, so the row is informational.
 */
function ProfileCard() {
  const { displayName } = usePreferences();

  return (
    <Card>
      <CardHeader title="Profile" />
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime text-sm font-bold text-lime-ink"
        >
          {(displayName ?? 'S').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{displayName ?? 'Student'}</span>
          <span className="block text-sm text-ink-muted">
            Anonymous device session — no account, no email.
          </span>
        </span>
      </div>
    </Card>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <p className="font-medium text-ink">{label}</p>
      {hint ? <p className="mt-0.5 text-sm text-ink-muted">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ChoiceGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 rounded-md border px-3.5 text-sm',
              selected
                ? 'border-nav bg-lime font-semibold text-lime-ink'
                : 'border-line-strong bg-surface text-ink hover:bg-surface-sunken',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{hint}</span>
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-1 h-7 w-12 shrink-0 rounded-full border transition-colors',
          checked ? 'border-nav bg-lime' : 'border-line-strong bg-surface-sunken',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-[left]',
            checked ? 'left-6' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}
