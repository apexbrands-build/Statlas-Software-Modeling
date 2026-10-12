import type { Format } from "../format";
import { compare, type Direction, type Tone } from "../metrics";

/** One column of a numeric report table. `direction` says which way is better for the heat map; "none" never colours. */
export interface ColumnDef {
  key: string;
  label: string;
  /** Group heading shown above consecutive columns that share it. */
  group?: string;
  format: Format;
  direction: Direction | "none";
}

export interface NumRow {
  key: string;
  label: string;
  /** Value per column key; null shows as "–". */
  v: Record<string, number | null>;
}

export interface NumTable {
  columns: ColumnDef[];
  rows: NumRow[];
  total: NumRow;
}

/** Heat-map tone of every value in a column, each compared with the column's average (within ±10% is neutral). */
export function columnTones(values: (number | null)[], direction: Direction | "none"): Tone[] {
  if (direction === "none") return values.map(() => "neutral");
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  return values.map((v) => compare(v, mean, direction).tone);
}
