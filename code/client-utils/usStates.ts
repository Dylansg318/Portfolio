// Code → full state name. Display-only: state columns are character(2), so we
// never store names — we expand codes for the operator and flag codes that
// aren't real states.
export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam',
  MP: 'Northern Mariana Islands', AS: 'American Samoa',
};

export function normalizeStateCode(code: unknown): string {
  return String(code == null ? '' : code).trim().toUpperCase();
}

export function isValidStateCode(code: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(US_STATE_NAMES, normalizeStateCode(code));
}

export interface StateLong {
  text: string;
  valid: boolean;
}

// { text, valid }. Valid → "Texas (TX)". Invalid → raw code, valid:false. Blank → "".
export function formatStateLong(code: unknown): StateLong {
  const c = normalizeStateCode(code);
  if (!c) return { text: '', valid: false };
  if (isValidStateCode(c)) return { text: `${US_STATE_NAMES[c]} (${c})`, valid: true };
  return { text: c, valid: false };
}

// Full name for valid codes; raw code otherwise. For compact rows (kanban card).
export function stateNameOnly(code: unknown): string {
  const c = normalizeStateCode(code);
  return US_STATE_NAMES[c] || c;
}
