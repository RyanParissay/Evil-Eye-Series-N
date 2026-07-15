interface HeaderProps {
  modeLabel: string;
}

export function Header({ modeLabel }: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
          <ellipse cx="15" cy="9" rx="13.5" ry="8" stroke="#fff" strokeWidth="1.6" fill="none" />
          <circle cx="15" cy="9" r="4" stroke="#fff" strokeWidth="1.6" fill="none" />
          <circle cx="15" cy="9" r="1.7" fill="#e0442c" />
        </svg>
        <span className="wordmark">
          EVIL EYE <span className="v2">V2</span>
        </span>
      </div>
      <span className="mode-badge">{modeLabel}</span>
    </header>
  );
}
