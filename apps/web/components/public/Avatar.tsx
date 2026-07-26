/**
 * Marketing V1 — deterministic initials avatar for public therapist
 * surfaces (revived from the archived marketplace, unchanged palette).
 * Used wherever a therapist has no photoUrl.
 */

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

const TONES = [
  'bg-[#E8F0EB] text-[#2D5F4D]',
  'bg-[#FDEEDD] text-[#9F5A2A]',
  'bg-[#E6E7F2] text-[#3F4673]',
  'bg-[#F0E6E9] text-[#7A3B49]',
  'bg-[#EEF1E6] text-[#5C6938]',
];

export function PublicAvatar({
  name,
  photoUrl,
  size = 48,
  className = '',
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  if (photoUrl) {
    // Plain <img>: therapist photos are arbitrary external URLs, which
    // next/image would need a remotePatterns allowlist for.
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const tone = TONES[hash % TONES.length];
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`grid place-items-center rounded-full font-serif font-semibold ${tone} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
