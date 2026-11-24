export const BRAND_TOKENS = {
  amber: '#CE7F20',
  cream: '#EEDFC7',
  olive: '#607938',
  brown: '#533416',
  surface: '#FBF6EC',
  inkOnAmber: '#2E1B0A',
  oliveText: '#4A5F28',
  muted: '#7A6248',
  riskHigh: '#A8482A',
  riskCritical: '#6E1F1B',
  border: '#D9C7A5',
  guide: '#E4D5B7',
  leaveTint: '#98846F',
  amberTint: '#F6E6CF',
  oliveTint: '#E9EFE0',
  siennaTint: '#F6E2DA',
  oxbloodTint: '#F2DCDC',
} as const;

export const CHART_SERIES_ORDER = [
  BRAND_TOKENS.amber,
  BRAND_TOKENS.olive,
  BRAND_TOKENS.brown,
  BRAND_TOKENS.riskHigh,
  BRAND_TOKENS.riskCritical,
] as const;

export const STATUS_COLOURS = {
  Present: BRAND_TOKENS.olive,
  Remote: BRAND_TOKENS.amber,
  Leave: BRAND_TOKENS.leaveTint,
  Absent: BRAND_TOKENS.riskHigh,
  'Needs Attention': BRAND_TOKENS.riskCritical,
} as const;

export const RISK_BAND_COLOURS = {
  Low: BRAND_TOKENS.olive,
  Medium: BRAND_TOKENS.amber,
  High: BRAND_TOKENS.riskHigh,
  Critical: BRAND_TOKENS.riskCritical,
} as const;
