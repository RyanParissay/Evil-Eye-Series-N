import { rationaleBody, rationaleLabel, type BrainView } from '../lib/brain';

export function RationalePanel({ r }: { r: BrainView['rationale'] }) {
  return (
    <section className="rationale">
      <div className="panel-label">{rationaleLabel(r.sent)}</div>
      <div className="rationale-body">{rationaleBody(r)}</div>
    </section>
  );
}
