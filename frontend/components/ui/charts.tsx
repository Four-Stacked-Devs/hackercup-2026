'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { shortDate } from '@/lib/format';

/**
 * Hand-drawn SVG rather than a charting library: a ring and a line do not
 * justify 40 KB on a mid-range phone. Everything here reads as text to a
 * screen reader, and lime always means progress.
 */

type Tone = 'lime' | 'strong' | 'developing' | 'attention' | 'neutral';

const TRACK_TONE: Record<Tone, string> = {
  lime: 'bg-lime',
  strong: 'bg-strong',
  developing: 'bg-developing',
  attention: 'bg-attention',
  neutral: 'bg-neutral',
};

const STROKE_TONE: Record<Tone, string> = {
  lime: 'var(--lime)',
  strong: 'var(--strong)',
  developing: 'var(--developing)',
  attention: 'var(--attention)',
  neutral: 'var(--neutral)',
};

export function ProgressBar({
  value,
  label,
  tone = 'lime',
  className,
}: {
  /** 0..1 */
  value: number;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', TRACK_TONE[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A labelled bar row, as in "Performance by topic". */
export function Meter({
  label,
  value,
  detail,
  tone = 'lime',
}: {
  label: ReactNode;
  /** 0..1 */
  value: number;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-[7rem] flex-1 truncate text-sm text-ink">{label}</span>
      <span className="min-w-[6rem] flex-1">
        <ProgressBar value={value} label={typeof label === 'string' ? label : 'Progress'} tone={tone} />
      </span>
      <span className="whitespace-nowrap text-xs font-semibold text-ink tabular-nums">
        {detail ?? `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}

/**
 * The stat tiles across the top of the analytics screens: one number, one
 * label, one optional change note.
 */
export function StatTile({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; text: string };
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ink tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
      {trend ? (
        <p
          className={cn(
            'mt-1 text-xs font-medium',
            trend.direction === 'up'
              ? 'text-strong-ink'
              : trend.direction === 'down'
                ? 'text-attention-ink'
                : 'text-ink-muted',
          )}
        >
          {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.text}
        </p>
      ) : null}
    </div>
  );
}

export function TrendLine({
  points,
  className,
}: {
  points: { date: string; accuracy: number; responseCount: number }[];
  className?: string;
}) {
  const width = 320;
  const height = 108;
  const padLeft = 26;
  const padRight = 6;
  const padY = 8;

  if (points.length === 0) return null;

  const step =
    points.length === 1 ? 0 : (width - padLeft - padRight) / Math.max(1, points.length - 1);

  const coords = points.map((point, index) => ({
    x: padLeft + index * step,
    y: padY + (1 - point.accuracy) * (height - padY * 2),
    point,
  }));

  const path = coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .join(' ');

  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <figure className={cn('m-0', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Accuracy from ${Math.round(first.accuracy * 100)}% on ${shortDate(first.date)} to ${Math.round(last.accuracy * 100)}% on ${shortDate(last.date)}`}
      >
        {[0, 0.5, 1].map((tick) => {
          const y = padY + (1 - tick) * (height - padY * 2);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text x={0} y={y + 3} className="fill-[var(--ink-subtle)]" style={{ fontSize: 9 }}>
                {tick * 100}%
              </text>
            </g>
          );
        })}

        <path
          d={path}
          fill="none"
          stroke="var(--lime)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((coord) => (
          <circle
            key={coord.point.date}
            cx={coord.x}
            cy={coord.y}
            r={3}
            fill="var(--surface)"
            stroke="var(--lime-strong)"
            strokeWidth={2}
          />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between pl-6 text-xs text-ink-muted">
        <span>{shortDate(first.date)}</span>
        <span>{shortDate(last.date)}</span>
      </figcaption>
    </figure>
  );
}

/** The progress ring. The number inside is the label, not decoration. */
export function ProgressRing({
  value,
  caption,
  size = 116,
  tone = 'lime',
}: {
  /** 0..1 */
  value: number;
  caption: string;
  size?: number;
  tone?: Tone;
}) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(1, Math.max(0, value));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${Math.round(value * 100)}% ${caption}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-sunken)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={STROKE_TONE[tone]}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="48%"
        textAnchor="middle"
        className="fill-[var(--ink)] font-bold"
        style={{ fontSize: size * 0.2 }}
      >
        {Math.round(value * 100)}%
      </text>
      <text
        x="50%"
        y="63%"
        textAnchor="middle"
        className="fill-[var(--ink-muted)]"
        style={{ fontSize: size * 0.085 }}
      >
        {caption}
      </text>
    </svg>
  );
}

/** Kept for callers that still name the old ring. */
export const MasteryRing = ProgressRing;

/** Step dots — "question 4 of 10" as a row you can see at a glance. */
export function StepProgress({
  total,
  current,
  label,
}: {
  total: number;
  /** 1-based */
  current: number;
  label: string;
}) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5" aria-label={label}>
      {Array.from({ length: total }, (_, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
              done
                ? 'border-lime bg-lime text-lime-ink'
                : active
                  ? 'border-nav bg-nav text-white'
                  : 'border-line bg-surface text-ink-subtle',
            )}
          >
            {step}
          </li>
        );
      })}
    </ol>
  );
}
