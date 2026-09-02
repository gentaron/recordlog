import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const MicIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </svg>
);

export const StopIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M9.5 5.5v13M14.5 5.5v13" />
  </svg>
);

export const PlayIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M8 5.5 18 12 8 18.5z" fill="currentColor" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const SparkIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6l-1.9-5.8L4.3 10.9 10.1 9z" />
    <path d="M18.6 3.4 19.3 5.4 21.3 6.1 19.3 6.8 18.6 8.8 17.9 6.8 15.9 6.1 17.9 5.4z" />
  </svg>
);

export const LayersIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M12 3 3 7.6l9 4.6 9-4.6z" />
    <path d="M3 12.2 12 16.8l9-4.6" />
    <path d="M3 16.6 12 21.2l9-4.6" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M4 6.5h16M9.5 6.5V4.6h5v1.9" />
    <path d="M6.4 6.5 7.2 20h9.6l.8-13.5" />
    <path d="M10.3 10v6M13.7 10v6" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.03z" />
  </svg>
);

export const SyncIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M20.5 12a8.5 8.5 0 0 1-14.6 6" />
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-6" />
    <path d="M18.1 2.6V6h-3.4M5.9 21.4V18h3.4" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 18.5h15" />
  </svg>
);

export const PencilIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </svg>
);

export const AlertIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.3v.2" />
  </svg>
);

export const CopyIcon = (p: P) => (
  <svg {...base(p)} aria-hidden="true">
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4" />
    <path d="M15.5 5.6A2.1 2.1 0 0 0 13.4 4H6.1A2.1 2.1 0 0 0 4 6.1v7.3a2.1 2.1 0 0 0 1.6 2" />
  </svg>
);
