import { Microscope } from 'lucide-react';
import { useBrandLogo, DEFAULT_BRAND_LOGO_SRC } from '../lib/brand-logo';
import { cn } from '../lib/utils';

/**
 * The brand tile: the lab's uploaded logo when one is saved, otherwise the
 * built-in microscope on its primary-colour tile.
 *
 * With a custom logo the image IS the tile — it fills `className`'s box edge
 * to edge and paints its own background. Overlaying it on the blue tile (or
 * padding it) made a white-background logo read as a stray white card, so
 * the primary surface is only applied to the microscope fallback.
 *
 * `className` sizes/shapes both cases (e.g. `h-14 w-14 rounded-[20px]`);
 * `iconClassName` only sizes the fallback icon.
 *
 * Deliberately not used on the logged-in Overview page's sidebar tile, which
 * keeps the splash-screen microscope treatment by owner decision; that site
 * pins its own default image.
 */
export default function BrandLogo({
  className,
  iconClassName,
  alt = 'PathoMitra logo',
}: {
  className?: string;
  iconClassName?: string;
  alt?: string;
}) {
  const customLogo = useBrandLogo();
  const logoSrc = customLogo || DEFAULT_BRAND_LOGO_SRC;

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-[18px]',
        className,
      )}
    >
      <img
        src={logoSrc}
        alt={alt}
        className={cn('h-full w-full object-cover', customLogo ? 'object-contain p-0.5' : '')}
        onError={e => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <span className="absolute inset-0 -z-10 flex items-center justify-center bg-primary text-on-primary">
        <Microscope className={iconClassName || 'h-5 w-5'} aria-hidden="true" />
      </span>
    </div>
  );
}
