import { setBrainAnchor } from '../lib/api';
import {
  anchorSub, anchorValue, cpeTile, creditsTile, dvTile, picksTile,
  type BrainView, type TileText,
} from '../lib/brain';

function Tile({ label, text }: { label: string; text: TileText }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{text.value}</div>
      <div className={`tile-sub ${text.tone}`}>{text.sub}</div>
    </div>
  );
}

interface EngineStripProps {
  brain: BrainView;
  refresh: () => void;
}

export function EngineStrip({ brain, refresh }: EngineStripProps) {
  const sub = anchorSub(brain.anchor);
  const cycle = async () => {
    await setBrainAnchor((brain.anchor.idx + 1) % 3);
    refresh();
  };
  return (
    <div className="engine-strip">
      <button className="tile tile-btn" onClick={() => { void cycle(); }}>
        <div className="tile-label">REFERENCE PRICER</div>
        <div className="tile-value">{anchorValue(brain.anchor.idx)}</div>
        <div className={`tile-sub ${sub.tone}`}>{sub.text}</div>
      </button>
      <Tile label="CREDITS" text={creditsTile(brain.tiles.credits)} />
      <Tile label="DOUBLE VERIFICATION" text={dvTile(brain.tiles.doubleVerification)} />
      <Tile label="TODAY'S PICKS" text={picksTile(brain.tiles.todaysPicks)} />
      <Tile label="CLOSING PRICE EDGE" text={cpeTile(brain.tiles.closingPriceEdge)} />
    </div>
  );
}
