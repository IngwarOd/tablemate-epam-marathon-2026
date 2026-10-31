export function splitBill(participants, tipPercent = 0) {
  if (!Number.isInteger(tipPercent) || tipPercent < 0 || tipPercent > 30) throw new RangeError('Некоректний відсоток чайових.');
  const rows = participants.filter(person => person.total > 0).map((person, index) => {
    const rawTip = person.total * tipPercent / 100;
    return { id: person.id, name: person.name, subtotal: person.total, tip: Math.floor(rawTip), remainder: rawTip % 1, index };
  });
  const subtotal = rows.reduce((sum, row) => sum + row.subtotal, 0);
  const tip = Math.round(subtotal * tipPercent / 100);
  let remaining = tip - rows.reduce((sum, row) => sum + row.tip, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining-- <= 0) break;
    row.tip += 1;
  }
  return { subtotal, tip, total: subtotal + tip, rows: rows.map(({ id, name, subtotal, tip }) => ({ id, name, subtotal, tip, total: subtotal + tip })) };
}
