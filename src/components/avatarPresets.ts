import {
  Dna,
  Droplets,
  FlaskConical,
  HeartPulse,
  Microscope,
  Pill,
  Stethoscope,
  Syringe,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface AvatarPreset {
  icon: LucideIcon;
  gradient: string;
  label: string;
}

export const DEFAULT_AVATAR_PRESET: AvatarPreset = {
  icon: User,
  gradient: 'from-slate-500 to-slate-700',
  label: 'Person',
};

/**
 * Built-in avatar presets — one consistent lucide glyph on a soft gradient
 * disc so every option reads as part of the same professional set. A seed is
 * either an http(s) image URL or one of these preset names; legacy seeds keep
 * resolving so already-saved profiles never break.
 */
export const AVATAR_PRESETS: Record<string, AvatarPreset> = {
  microscope: { icon: Microscope, gradient: 'from-sky-500 to-blue-600', label: 'Microscope' },
  droplets: { icon: Droplets, gradient: 'from-rose-500 to-red-600', label: 'Blood drops' },
  activity: { icon: HeartPulse, gradient: 'from-emerald-500 to-teal-600', label: 'Heart pulse' },
  flask: { icon: FlaskConical, gradient: 'from-amber-500 to-orange-600', label: 'Lab flask' },
  syringe: { icon: Syringe, gradient: 'from-violet-500 to-purple-600', label: 'Syringe' },
  dna: { icon: Dna, gradient: 'from-cyan-500 to-teal-600', label: 'DNA helix' },
  stethoscope: { icon: Stethoscope, gradient: 'from-indigo-500 to-blue-700', label: 'Stethoscope' },
  pill: { icon: Pill, gradient: 'from-fuchsia-500 to-pink-600', label: 'Pill' },
  user: DEFAULT_AVATAR_PRESET,
};

/** Human-readable name for an avatar seed — used for tooltips and aria-labels. */
export function avatarPresetLabel(seed: string): string {
  if (seed?.startsWith('http')) return 'Profile photo';
  return AVATAR_PRESETS[seed]?.label ?? DEFAULT_AVATAR_PRESET.label;
}
