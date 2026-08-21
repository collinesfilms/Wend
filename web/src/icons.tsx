// One icon set, drawn at 24x24 and rendered at whatever size is asked for.
type Props = { size?: number; width?: number; stroke?: number; className?: string }

function Svg({
  size = 18,
  width = 1.75,
  className,
  children,
}: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const Paste = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="17" rx="2.6" />
    <path d="M9 4.5V3.6A1.6 1.6 0 0110.6 2h2.8A1.6 1.6 0 0115 3.6v.9" />
  </Svg>
)
export const Bolt = (p: Props) => (
  <Svg {...p}>
    <path d="M13.2 2.5L4.8 13.4h6.1l-1 8.1 8.3-10.9h-6.1z" strokeLinejoin="round" />
  </Svg>
)
export const Pencil = (p: Props) => (
  <Svg {...p}>
    <path d="M12.5 20.5H21" />
    <path d="M16.6 3.4a2.05 2.05 0 012.9 2.9L7.6 18.2l-3.9 1 1-3.9z" strokeLinejoin="round" />
  </Svg>
)
export const Lock = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2.8" />
    <path d="M8 10V7.2a4 4 0 018 0V10" />
  </Svg>
)
export const Clock = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 6.8v5.6l3.6 2.1" />
  </Svg>
)
export const Copy = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2.6" />
    <path d="M5.2 15h-.7A1.5 1.5 0 013 13.5V5A1.5 1.5 0 014.5 3.5H13A1.5 1.5 0 0114.5 5v.7" />
  </Svg>
)
export const Qr = (p: Props) => (
  <Svg {...p}>
    <rect x="3.2" y="3.2" width="7" height="7" rx="1.6" />
    <rect x="13.8" y="3.2" width="7" height="7" rx="1.6" />
    <rect x="3.2" y="13.8" width="7" height="7" rx="1.6" />
    <path d="M13.8 13.8h3.1v3.1h-3.1zM20.8 13.8v2M13.8 20.8h2M18.8 18.8h2v2h-2z" />
  </Svg>
)
export const Tune = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8h9M17.5 8H20M4 16h3.5M12 16h8" />
    <circle cx="15.2" cy="8" r="2.2" />
    <circle cx="9.7" cy="16" r="2.2" />
  </Svg>
)
export const X = (p: Props) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
)
export const Back = (p: Props) => (
  <Svg {...p}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </Svg>
)
export const Search = (p: Props) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.8" />
    <path d="M15.8 15.8L20.5 20.5" />
  </Svg>
)
export const Check = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12.6l4.6 4.6L19 6.8" />
  </Svg>
)
export const Cycle = (p: Props) => (
  <Svg {...p}>
    <path d="M20.4 12a8.4 8.4 0 11-2.6-6.1" />
    <path d="M20.8 4v5h-5" />
  </Svg>
)
export const Eye = (p: Props) => (
  <Svg {...p}>
    <path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12z" />
    <circle cx="12" cy="12" r="2.9" />
  </Svg>
)
export const EyeOff = (p: Props) => (
  <Svg {...p}>
    <path d="M9.6 6.2A9.6 9.6 0 0112 6c5.8 0 9.4 6 9.4 6a17 17 0 01-3 3.7M6.4 7.9A16.7 16.7 0 002.6 12S6.2 18 12 18a9.5 9.5 0 003.4-.6" />
    <path d="M4.5 4.5l15 15" />
  </Svg>
)
export const Rows = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4.2" width="18" height="6.2" rx="2.2" />
    <rect x="3" y="13.6" width="18" height="6.2" rx="2.2" />
  </Svg>
)
export const Sun = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6" />
  </Svg>
)
export const Moon = (p: Props) => (
  <Svg {...p}>
    <path d="M20.4 14.6A8.6 8.6 0 019.4 3.6a8.6 8.6 0 1011 11z" />
  </Svg>
)
export const Key = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="4.2" />
    <path d="M12.2 12H21M18.2 12v3.1M15.2 12v2.4" />
  </Svg>
)
export const Plus = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5.2v13.6M5.2 12h13.6" />
  </Svg>
)
export const Out = (p: Props) => (
  <Svg {...p} width={2}>
    <path d="M7.4 16.6L16.6 7.4M8.6 7.4h8v8" strokeLinejoin="round" />
  </Svg>
)
export const Gear = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.4a1.6 1.6 0 00.32 1.77l.06.06a1.94 1.94 0 11-2.75 2.75l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-.97 1.47v.16a1.94 1.94 0 11-3.88 0v-.09a1.6 1.6 0 00-1.05-1.47 1.6 1.6 0 00-1.77.32l-.06.06a1.94 1.94 0 11-2.75-2.75l.06-.06a1.6 1.6 0 00.32-1.77 1.6 1.6 0 00-1.47-.97h-.16a1.94 1.94 0 110-3.88h.09a1.6 1.6 0 001.47-1.05 1.6 1.6 0 00-.32-1.77l-.06-.06a1.94 1.94 0 112.75-2.75l.06.06a1.6 1.6 0 001.77.32h.08a1.6 1.6 0 00.97-1.47v-.16a1.94 1.94 0 113.88 0v.09a1.6 1.6 0 00.97 1.47 1.6 1.6 0 001.77-.32l.06-.06a1.94 1.94 0 112.75 2.75l-.06.06a1.6 1.6 0 00-.32 1.77v.08a1.6 1.6 0 001.47.97h.16a1.94 1.94 0 110 3.88h-.09a1.6 1.6 0 00-1.47.97z" />
  </Svg>
)
export const Trash = (p: Props) => (
  <Svg {...p}>
    <path d="M4 6.8h16M9.4 6.8V4.6h5.2v2.2M6.6 6.8l.9 13.2h9l.9-13.2" />
  </Svg>
)
