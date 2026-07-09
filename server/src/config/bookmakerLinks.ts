/**
 * Homepage fallbacks for major bookmakers, keyed by The Odds API bookmaker key.
 *
 * The API includes per-bookmaker (and on some plans per-outcome) `link`
 * fields; those always win. This map is only consulted when the API gives
 * no link, so every leg in the UI stays clickable.
 */
export const BOOKMAKER_HOMEPAGES: Record<string, string> = {
  // US
  fanduel: 'https://sportsbook.fanduel.com',
  draftkings: 'https://sportsbook.draftkings.com',
  betmgm: 'https://sports.betmgm.com',
  williamhill_us: 'https://www.caesars.com/sportsbook-and-casino',
  betrivers: 'https://www.betrivers.com',
  espnbet: 'https://espnbet.com',
  hardrockbet: 'https://app.hardrock.bet',
  fanatics: 'https://sportsbook.fanatics.com',
  bovada: 'https://www.bovada.lv',
  mybookieag: 'https://www.mybookie.ag',
  betonlineag: 'https://www.betonline.ag',
  lowvig: 'https://www.lowvig.ag',
  ballybet: 'https://play.ballybet.com',
  // Sharp / EU
  pinnacle: 'https://www.pinnacle.com',
  onexbet: 'https://1xbet.com',
  sport888: 'https://www.888sport.com',
  betclic: 'https://www.betclic.com',
  betsson: 'https://www.betsson.com',
  nordicbet: 'https://www.nordicbet.com',
  tipico_de: 'https://www.tipico.de',
  marathonbet: 'https://www.marathonbet.com',
  matchbook: 'https://www.matchbook.com',
  betfair_ex_eu: 'https://www.betfair.com/exchange',
  // UK
  betfair_ex_uk: 'https://www.betfair.com/exchange',
  betfair_sb_uk: 'https://www.betfair.com/sport',
  bet365: 'https://www.bet365.com',
  williamhill: 'https://www.williamhill.com',
  ladbrokes_uk: 'https://sports.ladbrokes.com',
  coral: 'https://sports.coral.co.uk',
  paddypower: 'https://www.paddypower.com',
  skybet: 'https://m.skybet.com',
  unibet_uk: 'https://www.unibet.co.uk',
  unibet_eu: 'https://www.unibet.com',
  betvictor: 'https://www.betvictor.com',
  betway: 'https://betway.com',
  boylesports: 'https://www.boylesports.com',
  casumo: 'https://www.casumo.com/sports',
  grosvenor: 'https://www.grosvenorcasinos.com/sports',
  leovegas: 'https://www.leovegas.com/sports',
  livescorebet: 'https://www.livescorebet.com',
  mrgreen: 'https://www.mrgreen.com/sports',
  virginbet: 'https://www.virginbet.com',
  // AU
  sportsbet: 'https://www.sportsbet.com.au',
  tab: 'https://www.tab.com.au',
  neds: 'https://www.neds.com.au',
  ladbrokes_au: 'https://www.ladbrokes.com.au',
  pointsbetau: 'https://pointsbet.com.au',
  unibet: 'https://www.unibet.com',
  bluebet: 'https://www.bluebet.com.au',
  playup: 'https://www.playup.com.au',
};

/** Resolve a clickable URL for a bookmaker, or null if we know nothing. */
export function bookmakerHomepage(bookmakerKey: string): string | null {
  return BOOKMAKER_HOMEPAGES[bookmakerKey] ?? null;
}
