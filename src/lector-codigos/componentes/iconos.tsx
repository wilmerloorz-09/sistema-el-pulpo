const paths: Record<string, string> = {
  scan: "M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 7v10m3-10v10m4-10v10m3-10v10",
  barcode:
    "M3 5v14m3-14v14m3-14v14m4-14v14m3-14v14m2-14v14m3-14v14",
  history: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v5l3 2",
  grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M19 12H5m0 0 6-6M5 12l6 6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
  store:
    "M3 10v10h18V10M2 10l2-7h16l2 7M2 10c0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0M8 20v-6h8v6",
  lock: "M6 10h12v11H6zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2",
  flask: "M9 3h6m-5 0v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10",
  refresh: "M21 7v5h-5M3 17v-5h5M4.5 7a8 8 0 0 1 13-3L21 8M3 16l3.5 4a8 8 0 0 0 13-3",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  info: "M12 8h.01M11 12h1v5m9-5a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  table: "M3 9h18v4H3zm2 4v8m14-8v8M7 3v6m10-6v6",
  bag: "M5 7h14l2 14H3ZM8 7V5a4 4 0 0 1 8 0v2",
  check: "m5 12 4 4L19 6",
  camera: "M3 7h4l2-3h6l2 3h4v14H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash:
    "M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  close: "m6 6 12 12M6 18 18 6",
  bottle: "M9 2h6v5l3 5v9H6v-9l3-5ZM6 13h12",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
  users: "M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4ZM8 13a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8 13Zm8 2c-3.2 0-6 1.7-6 3.5V21h12v-2.5c0-1.8-2.8-3.5-6-3.5ZM8 15c-2.7 0-5 1.4-5 3v3h5",
  dollar: "M12 3v18m4-14.5A3.5 3.5 0 0 0 12.5 5h-1A3.5 3.5 0 0 0 8 8.5 3.5 3.5 0 0 0 11.5 12h1A3.5 3.5 0 0 1 16 15.5 3.5 3.5 0 0 1 12.5 19h-1A3.5 3.5 0 0 1 8 15.5",
};

export function Icono({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.info} />
    </svg>
  );
}

export function MarcaPulpo() {
  return (
    <svg viewBox="0 0 58 62" fill="none" aria-hidden="true">
      <path
        d="M14 29a15 15 0 0 1 30 0v10c0 8 11 8 10-1M14 35c0 13-12 12-10 3m18-2v13c0 9 10 9 10 0V37m8 0v11c0 9 11 9 11 0"
        stroke="#e9edda"
        strokeWidth="4.3"
        strokeLinecap="round"
      />
      <circle cx="23" cy="28" r="2" fill="#e9edda" />
      <circle cx="35" cy="28" r="2" fill="#e9edda" />
      <path d="M25 35q4 3 8 0" stroke="#efb17f" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
