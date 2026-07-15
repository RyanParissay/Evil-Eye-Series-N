// Simulated odds provider (Task 9). Deterministic given the injected rng — never reads the
// clock, env, or Math.random. Every fetch covers ~10 events across the seeded books' sports
// (pinnacle benchmarks every event) and PLANTS work for the pipeline: two arbs (one 3-leg
// soccer 1X2), two EV spots (soft price above pinnacle devig fair) and one middle pair on
// split total lines. Quotes drift ±2% between consecutive fetches (cumulative drift clamped
// to ±2.5% around the planted base) so verification sometimes fails naturally.
import type { OddsProvider, Quote } from '../shared/types.js';

const PINNACLE_VIG = 0.045; // pinnacle quotes fair/(1+vig); multiplicative devig recovers fair exactly
const OFF_FAIR = 0.95; //     non-planted soft quotes sit ~5% under fair — no accidental edges at base
const ARB_BOOST_MIN = 0.02; // planted arb legs: fair*(1+b) → base margin b/(1+b) ≈ 2.0–2.9%
const ARB_BOOST_MAX = 0.03;
const EV_BOOST_MIN = 0.04; //  planted EV quote: fair*(1+e) → base edge e = 4–6% (>= min 2%)
const EV_BOOST_MAX = 0.06;
const DRIFT_STEP = 0.02; //    max ±2% odds move per consecutive fetch
const DRIFT_MIN = 0.975; //    cumulative clamp keeps planted opportunities mostly (not always) alive
const DRIFT_MAX = 1.025;
const MIN_START_MS = 30 * 60_000; //     event starts spread 30min–48h out from creation
const MAX_START_MS = 48 * 3_600_000;

interface QuoteSpec {
  book: string; market: string; selection: string; line: number | null;
  baseOdds: number; drift: number;
}
interface SimEvent { name: string; sport: string; startsAt: number; quotes: QuoteSpec[] }

type Slot =
  | { role: 'ARB2' | 'EV' | 'MIDDLE' | 'PLAIN2' | 'PLAIN3'; sport: string; books: readonly [string, string] }
  | { role: 'ARB3'; sport: string; books: readonly [string, string, string] };

// One slot per event. Books match their seeded sport (ONE_SPORT_RULE); pinnacle (ANY) is
// added to every event by the builders. Slots regenerate a fresh event once theirs starts.
const ROSTER: Slot[] = [
  { role: 'ARB2', sport: 'basketball', books: ['bet365', 'fanduel'] },
  { role: 'ARB3', sport: 'soccer', books: ['sportsinteraction', 'betway', 'bwin'] },
  { role: 'EV', sport: 'baseball', books: ['draftkings', 'betmgm'] },
  { role: 'EV', sport: 'hockey', books: ['caesars', 'bet99'] },
  { role: 'MIDDLE', sport: 'basketball', books: ['pointsbet', 'bet365'] },
  { role: 'PLAIN2', sport: 'tennis', books: ['unibet', 'bodog'] },
  { role: 'PLAIN3', sport: 'soccer', books: ['betvictor', 'betway'] },
  { role: 'PLAIN2', sport: 'hockey', books: ['leovegas', 'caesars'] },
  { role: 'PLAIN2', sport: 'baseball', books: ['betrivers', 'draftkings'] },
  { role: 'PLAIN2', sport: 'basketball', books: ['pointsbet', 'fanduel'] },
];

type Probs = Array<[selection: string, prob: number]>;

function spec(book: string, market: string, selection: string, line: number | null, baseOdds: number): QuoteSpec {
  return { book, market, selection, line, baseOdds, drift: 1 };
}

/** Pinnacle benchmark: all outcomes of one market+line, priced fair/(1+vig). */
function pinnacleSet(market: string, line: number | null, probs: Probs): QuoteSpec[] {
  return probs.map(([sel, p]) => spec('pinnacle', market, sel, line, 1 / p / (1 + PINNACLE_VIG)));
}

/** Emitted odds: planted base × current drift, floored above 1 and rounded to 3 decimals. */
function emitOdds(s: QuoteSpec): number {
  return Math.max(1.01, Math.round(s.baseOdds * s.drift * 1000) / 1000);
}

export function SimOddsProvider(rng: () => number): OddsProvider {
  let counter = 0;
  const events: Array<SimEvent | null> = ROSTER.map(() => null);

  const uniform = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const twoWay = (): Probs => {
    const home = uniform(0.35, 0.65);
    return [['home', home], ['away', 1 - home]];
  };
  const threeWay = (): Probs => {
    const home = uniform(0.3, 0.55);
    const draw = uniform(0.22, 0.3);
    return [['home', home], ['draw', draw], ['away', 1 - home - draw]];
  };
  /** Both soft books quote every outcome under fair — coverage without opportunities. */
  const plain = (market: string, probs: Probs, books: readonly string[]): QuoteSpec[] => {
    const specs = pinnacleSet(market, null, probs);
    for (const book of books) {
      const off = uniform(0.94, 0.97);
      for (const [sel, p] of probs) specs.push(spec(book, market, sel, null, (1 / p) * off));
    }
    return specs;
  };

  /** Outcome i boosted above fair at books[i], everything else under fair → n-leg arb. */
  const plantedArb = (market: string, probs: Probs, books: readonly string[]): QuoteSpec[] => {
    const boost = uniform(ARB_BOOST_MIN, ARB_BOOST_MAX);
    const specs = pinnacleSet(market, null, probs);
    for (const book of books) {
      probs.forEach(([sel, p], i) => {
        specs.push(spec(book, market, sel, null, (1 / p) * (books[i] === book ? 1 + boost : OFF_FAIR)));
      });
    }
    return specs;
  };

  function buildQuotes(slot: Slot): QuoteSpec[] {
    switch (slot.role) {
      case 'ARB2': // each side boosted above fair at a different book → 2-leg arb
        return plantedArb('moneyline', twoWay(), slot.books);
      case 'ARB3': // soccer 1X2: home/draw/away each boosted at a different book → 3-leg arb
        return plantedArb('1X2', threeWay(), slot.books);
      case 'EV': { // soft book prices the underdog 4–6% above pinnacle fair → EV spot, no arb
        const evProb = uniform(0.3, 0.4);
        const probs: Probs = [['home', 1 - evProb], ['away', evProb]];
        const boost = uniform(EV_BOOST_MIN, EV_BOOST_MAX);
        const [evBook, other] = slot.books;
        return [
          ...pinnacleSet('moneyline', null, probs),
          spec(evBook, 'moneyline', 'away', null, (1 / evProb) * (1 + boost)),
          spec(evBook, 'moneyline', 'home', null, (1 / (1 - evProb)) * 0.94),
          spec(other, 'moneyline', 'home', null, (1 / (1 - evProb)) * 0.96),
          spec(other, 'moneyline', 'away', null, (1 / evProb) * OFF_FAIR),
        ];
      }
      case 'MIDDLE': { // over(mid-3) at one book, under(mid+3) at another → 6-point window
        const mid = 210.5 + Math.floor(rng() * 40); // always x.5 — no pushes
        const pOver = uniform(0.48, 0.52);
        const overOdds = uniform(1.98, 2.06);
        const underOdds = uniform(1.98, 2.06);
        const [overBook, underBook] = slot.books;
        return [
          ...pinnacleSet('total', mid, [['over', pOver], ['under', 1 - pOver]]),
          spec(overBook, 'total', 'over', mid - 3, overOdds),
          spec(overBook, 'total', 'under', mid - 3, 1 / (1.04 - 1 / overOdds)), // ~4% book vig
          spec(underBook, 'total', 'under', mid + 3, underOdds),
          spec(underBook, 'total', 'over', mid + 3, 1 / (1.04 - 1 / underOdds)),
        ];
      }
      case 'PLAIN2':
        return plain('moneyline', twoWay(), slot.books);
      case 'PLAIN3':
        return plain('1X2', threeWay(), slot.books);
    }
  }

  return {
    fetchQuotes(now: number): Quote[] {
      const out: Quote[] = [];
      ROSTER.forEach((slot, i) => {
        let ev = events[i];
        if (!ev || ev.startsAt <= now) {
          // (Re)plant: fresh identity, base odds carry the full planted edge, drift resets.
          counter += 1;
          ev = {
            name: `SIM-EVT-${counter}`,
            sport: slot.sport,
            startsAt: Math.round(now + uniform(MIN_START_MS, MAX_START_MS)),
            quotes: buildQuotes(slot),
          };
          events[i] = ev;
        } else {
          for (const s of ev.quotes) {
            const next = s.drift * (1 + (rng() * 2 - 1) * DRIFT_STEP);
            s.drift = Math.min(DRIFT_MAX, Math.max(DRIFT_MIN, next));
          }
        }
        for (const s of ev.quotes) {
          out.push({
            book: s.book, sport: ev.sport, event: ev.name, market: s.market,
            selection: s.selection, odds: emitOdds(s), line: s.line,
            fetchedAt: now, eventStartsAt: ev.startsAt,
          });
        }
      });
      return out;
    },
  };
}
