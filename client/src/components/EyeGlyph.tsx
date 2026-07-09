/**
 * The evil-eye mark. Inline SVG only — no image assets. The `state` prop
 * lets the same glyph carry the loading (scanning) and empty (closed)
 * states so the brand mark does the storytelling.
 */
interface EyeGlyphProps {
  size?: number;
  state?: 'open' | 'scanning' | 'closed';
}

export function EyeGlyph({ size = 44, state = 'open' }: EyeGlyphProps) {
  const height = size * 0.55;
  if (state === 'closed') {
    return (
      <svg width={size} height={height} viewBox="0 0 48 26" aria-hidden="true">
        <path d="M3 13 Q24 24 45 13" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 17 L10 21 M24 19 L24 24 M36 17 L38 21" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width={size} height={height} viewBox="0 0 48 26" aria-hidden="true">
      <path
        d="M3 13 Q24 -3 45 13 Q24 29 3 13 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="24"
        cy="13"
        r="6"
        fill="#FF2B2B"
        className={state === 'scanning' ? 'iris iris-scanning' : 'iris'}
      />
      <circle cx="24" cy="13" r="2.2" fill="#000" />
    </svg>
  );
}
