export const toMap = <T extends { date: string }>(rows: T[]) => new Map(rows.map((r) => [r.date, r]));
