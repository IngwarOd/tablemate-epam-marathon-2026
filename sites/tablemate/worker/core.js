function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function text(value, label, max = 50) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}: введіть від 1 до ${max} символів.`);
  return value.trim();
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label}: допустиме значення від ${min} до ${max}.`);
  return value;
}
function totals(session) {
  return session.items.reduce((sum, item) => sum + MENU.find(d => d.id === item.dishId).price * item.quantity, 0);
}
function participant(session) {
  return {
    id: session.id,
    type: session.type,
    name: session.name,
    avoid: session.avoid,
    items: session.items.map(item => ({ dish: MENU.find(d => d.id === item.dishId), quantity: item.quantity })),
    total: totals(session),
    isSubmitted: session.submitted
  };
}
function insights(group) {
  const participants = group.sessions.map(participant);
  const total = participants.reduce((sum, p) => sum + p.total, 0);
  const submittedTotal = participants.filter(p => p.isSubmitted).reduce((sum, p) => sum + p.total, 0);
  const conflicts = group.status === 'Submitted' ? [] : participants.flatMap(p => p.items.flatMap(item => {
    const found = item.dish.allergens.filter(a => p.avoid.includes(a));
    return found.length ? [{ participant: p.name, dish: item.dish.name, allergens: found }] : [];
  }));
  let swap = null;
  if (group.status === 'Open' && total > group.budget) {
    const options = participants.filter(p => !p.isSubmitted).flatMap(p => p.items.map(item => {
      const cheaper = MENU.filter(d => d.category === item.dish.category && d.price < item.dish.price && !d.allergens.some(a => p.avoid.includes(a)))
        .sort((a, b) => a.price - b.price)[0];
      return cheaper ? { participant: p.name, from: item.dish.name, to: cheaper.name, saving: (item.dish.price - cheaper.price) * item.quantity } : null;
    })).filter(Boolean).sort((a, b) => b.saving - a.saving);
    swap = options[0] || null;
  }
  const budgetTotal = group.status === 'Submitted' ? submittedTotal : total;
  return { total, submittedTotal, budgetTotal, remaining: group.budget - budgetTotal, conflicts, swap, waiting: participants.filter(p => !p.isSubmitted).map(p => p.name) };
}
function snapshot(group, auth) {
  const visible = auth.role === 'owner' ? group.sessions : [auth.session];
  return {
    id: group.id, title: group.title, serviceAt: group.serviceAt, timeZone: group.timeZone, utcOffsetMinutes: group.utcOffsetMinutes, guestLimit: group.guestLimit,
    budget: group.budget, status: group.status, inviteCode: auth.role === 'owner' ? group.inviteCode : undefined,
    mySessionId: auth.session.id, role: auth.role, participants: visible.map(participant),
    insights: auth.role === 'owner' ? insights(group) : undefined,
    order: auth.role === 'owner' ? group.order : undefined
  };
}
function validateItems(value) {
  if (!Array.isArray(value) || value.length > MENU.length) fail(400, 'Некоректний кошик.');
  const ids = new Set();
  return value.map(item => {
    if (!item || typeof item.dishId !== 'string' || !MENU.some(d => d.id === item.dishId) || ids.has(item.dishId)) fail(400, 'Некоректна страва або дубль у кошику.');
    ids.add(item.dishId);
    return { dishId: item.dishId, quantity: integer(item.quantity, 'Кількість', 1, 20) };
  });
}
