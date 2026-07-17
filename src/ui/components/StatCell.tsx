interface StatCellProps {
  label: string;
  value: string | number;
  unit?: string;
}

/** A glance-zone stat: big tabular numeral + label (DESIGN §3/§4). */
export function StatCell({ label, value, unit }: StatCellProps) {
  return (
    <div className="wr-stat">
      <div className="wr-stat__value tabular">
        {value}
        {unit ? <span className="wr-stat__unit"> {unit}</span> : null}
      </div>
      <div className="wr-stat__label">{label}</div>
    </div>
  );
}
