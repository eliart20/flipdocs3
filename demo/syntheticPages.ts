const palette = [
  ["#f2ede2", "#fe5f55", "#14213d"],
  ["#e6f5ee", "#008c7a", "#18332f"],
  ["#f5e9f2", "#a54d90", "#332036"],
  ["#e9edf8", "#4361a8", "#17223b"],
  ["#fff0dc", "#e8792e", "#3c2517"],
  ["#e8f3f5", "#147d92", "#16343b"],
];

function escapeSvg(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

export function makeSyntheticPages(count = 12): string[] {
  return Array.from({ length: count }, (_, index) => {
    const page = index + 1;
    const [paper, accent, ink] = palette[index % palette.length]!;
    const chapter = page === 1 ? "COVER" : `SECTION ${String(Math.ceil(page / 2)).padStart(2, "0")}`;
    const arrow = page % 2 === 0 ? "READ  →" : "←  READ";
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
        <rect width="900" height="1200" fill="${paper}"/>
        <rect x="24" y="24" width="852" height="1152" rx="3" fill="none" stroke="${ink}" stroke-width="5"/>
        <path d="M60 136H840M60 1028H840" stroke="${accent}" stroke-width="4"/>
        <text x="62" y="98" fill="${ink}" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="7">${escapeSvg(chapter)}</text>
        <text x="450" y="524" text-anchor="middle" fill="${accent}" font-family="Arial, sans-serif" font-size="250" font-weight="900">${page}</text>
        <text x="450" y="612" text-anchor="middle" fill="${ink}" font-family="Arial, sans-serif" font-size="31" font-weight="700" letter-spacing="9">PAGE ORIENTATION</text>
        <text x="450" y="690" text-anchor="middle" fill="${ink}" font-family="Arial, sans-serif" font-size="52" font-weight="900">${escapeSvg(arrow)}</text>
        <g fill="none" stroke="${accent}" stroke-width="5">
          <path d="M110 770H790"/>
          <path d="m110 770 35-22v44zM790 770l-35-22v44z" fill="${accent}"/>
          <circle cx="450" cy="890" r="82"/>
          <path d="M450 824v132M384 890h132"/>
        </g>
        <text x="76" y="1110" fill="${ink}" font-family="Arial, sans-serif" font-size="24" font-weight="700">OUTER / LEFT</text>
        <text x="824" y="1110" text-anchor="end" fill="${ink}" font-family="Arial, sans-serif" font-size="24" font-weight="700">RIGHT / OUTER</text>
        <text x="450" y="1142" text-anchor="middle" fill="${accent}" font-family="Arial, sans-serif" font-size="19" font-weight="700" letter-spacing="4">TOP • FRONT • NOT MIRRORED</text>
      </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
