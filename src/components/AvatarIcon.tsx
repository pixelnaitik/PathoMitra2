import { AVATAR_PRESETS, DEFAULT_AVATAR_PRESET } from './avatarPresets';

/**
 * Shared avatar renderer used by the dashboard sidebar and the settings page.
 * `seed` is either an http(s) image URL or one of the built-in preset names.
 */
export default function AvatarIcon({ seed, pad = 'p-2' }: { seed: string; pad?: string }) {
  // HTTPS-only remote avatars: plain-http or otherwise crafted seeds must never
  // turn the dashboard into a beacon for third-party servers.
  if (seed?.startsWith('https://')) {
    return (
      <img
        src={seed}
        alt="Avatar"
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  const preset = AVATAR_PRESETS[seed] ?? DEFAULT_AVATAR_PRESET;
  const Icon = preset.icon;
  return (
    <div
      className={`w-full h-full rounded-full bg-gradient-to-br ${preset.gradient} flex items-center justify-center`}
      role="img"
      aria-label={preset.label}
    >
      <Icon className={`w-full h-full ${pad} text-white`} strokeWidth={2.25} aria-hidden="true" />
    </div>
  );
}
