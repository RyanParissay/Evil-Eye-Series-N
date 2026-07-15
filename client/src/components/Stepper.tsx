interface StepperProps {
  value: string;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}

/** §5.2 stepper anatomy: value + −/+ 22×22 buttons. Steps/floors live in the caller. */
export function Stepper({ value, onDec, onInc, disabled = false }: StepperProps) {
  return (
    <span className="stepper">
      <span className="stepper-value">{value}</span>
      <button className="step-btn" onClick={onDec} disabled={disabled}>−</button>
      <button className="step-btn" onClick={onInc} disabled={disabled}>+</button>
    </span>
  );
}
