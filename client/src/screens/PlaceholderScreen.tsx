interface PlaceholderScreenProps {
  label: string;
  planNumber: 3 | 4 | 5;
}

export function PlaceholderScreen({ label, planNumber }: PlaceholderScreenProps) {
  return (
    <section className="placeholder">
      <div className="placeholder-label">{label}</div>
      <div className="placeholder-body">ARRIVES WITH PLAN {planNumber}</div>
    </section>
  );
}
