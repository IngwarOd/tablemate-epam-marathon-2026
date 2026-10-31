const MENU = __MENU__;
const assets = __ASSETS__;
const ALLERGENS = ['Глютен', 'Молоко', 'Яйця', 'Риба', 'Соя', 'Кунжут'];
/* __CORE__ */

function token() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sameToken(provided, storedHash) {
  if (!provided || typeof storedHash !== 'string') return false;
  const candidate = await hash(provided);
  let mismatch = candidate.length ^ storedHash.length;
  for (let i = 0; i < candidate.length; i++) mismatch |= candidate.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return mismatch === 0;
}
function bearer(request) { const value = request.headers.get('authorization') || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
async function access(group, request) {
  const credential = bearer(request);
  if (await sameToken(credential, group.ownerTokenHash)) return { role: 'owner', session: group.sessions.find(session => session.type === 'Owner') };
  for (const session of group.sessions) if (await sameToken(credential, session.tokenHash)) return { role: 'guest', session };
  fail(403, 'Немає доступу до цієї групи.');
}
async function owner(group, request) {
  const auth = await access(group, request);
  if (auth.role !== 'owner') fail(403, 'Дія доступна лише організатору.');
  return auth;
}
async function body(request) {
  const raw = await request.text();
  if (raw.length > 16_384) fail(413, 'Завеликий запит.');
  let parsed;
  try { parsed = JSON.parse(raw || '{}'); } catch { fail(400, 'Некоректний JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Очікується JSON-об’єкт.');
  return parsed;
}
function json(status, value) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
async function loadGroup(bucket, id) {
  const object = await bucket.get(`groups/${id}.json`);
  if (!object) fail(404, 'Групу не знайдено.');
  return { group: await object.json(), etag: object.etag };
}
async function saveGroup(bucket, group, etag) {
  const saved = await bucket.put(`groups/${group.id}.json`, JSON.stringify(group), {
    onlyIf: etag ? { etagMatches: etag } : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json' }
  });
  if (!saved) fail(409, 'Стіл змінився. Оновіть сторінку та повторіть дію.');
}
function staticResponse(request, pathname) {
  const path = ['/', '/join', '/kitchen'].includes(pathname) ? '/index.html' : pathname;
  const contents = assets[path];
  if (contents === undefined) fail(404, 'Файл не знайдено.');
  const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
  return new Response(request.method === 'HEAD' ? null : contents, { headers: { 'content-type': `${type}; charset=utf-8`, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}
async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') {
    if (request.method !== 'GET' && request.method !== 'HEAD') fail(405, 'Метод не підтримується.');
    return staticResponse(request, url.pathname);
  }
  if (request.method === 'GET' && url.pathname === '/api/menu') return json(200, { dishes: MENU, allergens: ALLERGENS });
  if (request.method === 'POST' && url.pathname === '/api/groups') {
    const input = await body(request);
    if (typeof input.serviceAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.serviceAt)) fail(400, 'Дата має містити часовий пояс.');
    const serviceAt = new Date(input.serviceAt);
    if (!Number.isFinite(serviceAt.getTime()) || serviceAt.getTime() < Date.now() - 60_000) fail(400, 'Оберіть майбутню дату зустрічі.');
    const timeZone = typeof input.timeZone === 'string' ? input.timeZone : 'UTC';
    if (timeZone.length > 100) fail(400, 'Некоректний часовий пояс.');
    try { new Intl.DateTimeFormat('en', { timeZone }); } catch { fail(400, 'Некоректний часовий пояс.'); }
    const ownerToken = token();
    const kitchenToken = token();
    const group = { id: crypto.randomUUID(), title: text(input.title, 'Назва зустрічі', 80), serviceAt: serviceAt.toISOString(), timeZone,
      utcOffsetMinutes: input.utcOffsetMinutes === undefined ? 0 : integer(input.utcOffsetMinutes, 'Зсув часового поясу', -840, 840),
      guestLimit: integer(input.guestLimit, 'Кількість гостей', 2, 20), budget: integer(input.budget, 'Бюджет', 100, 100_000),
      status: 'Open', ownerTokenHash: await hash(ownerToken), kitchenTokenHash: await hash(kitchenToken), inviteCode: token(), order: null,
      sessions: [{ id: crypto.randomUUID(), type: 'Owner', name: text(input.ownerName, 'Ім’я організатора'), avoid: [], items: [], submitted: false, tokenHash: await hash(ownerToken) }] };
    await saveGroup(env.BUCKET, group);
    return json(201, { group: snapshot(group, { role: 'owner', session: group.sessions[0] }), token: ownerToken, kitchenToken });
  }
  if (parts[1] !== 'groups' || !parts[2]) fail(404, 'Маршрут не знайдено.');
  const { group, etag } = await loadGroup(env.BUCKET, parts[2]);
  if (request.method === 'GET' && parts.length === 4 && parts[3] === 'kitchen') {
    if (!(await sameToken(bearer(request), group.kitchenTokenHash))) fail(403, 'Немає доступу до кухонного талона.');
    return json(200, { title: group.title, serviceAt: group.serviceAt, timeZone: group.timeZone, utcOffsetMinutes: group.utcOffsetMinutes, status: group.status, order: group.order });
  }
  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
    const input = await body(request);
    if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
    if (input.inviteCode !== group.inviteCode) fail(403, 'Недійсне запрошення.');
    if (group.sessions.length >= group.guestLimit) fail(409, 'Усі місця за столом зайняті.');
    const avoid = input.avoid ?? [];
    if (!Array.isArray(avoid) || avoid.some(allergen => !ALLERGENS.includes(allergen)) || new Set(avoid).size !== avoid.length) fail(400, 'Некоректні харчові обмеження.');
    const guestToken = token();
    const session = { id: crypto.randomUUID(), type: 'Guest', name: text(input.name, 'Ім’я гостя'), avoid, items: [], submitted: false, tokenHash: await hash(guestToken) };
    group.sessions.push(session); await saveGroup(env.BUCKET, group, etag);
    return json(201, { group: snapshot(group, { role: 'guest', session }), token: guestToken });
  }
  if (request.method === 'GET' && parts.length === 3) return json(200, snapshot(group, await access(group, request)));
  if (request.method === 'GET' && parts.length === 4 && parts[3] === 'sessions') {
    await owner(group, request);
    const participants = group.sessions.map(participant);
    return json(200, { participants, total: participants.reduce((sum, person) => sum + person.total, 0) });
  }
  if (request.method === 'PATCH' && parts.length === 4 && parts[3] === 'budget') {
    const auth = await owner(group, request);
    if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
    group.budget = integer((await body(request)).budget, 'Бюджет', 100, 100_000);
    await saveGroup(env.BUCKET, group, etag);
    return json(200, snapshot(group, auth));
  }
  if (parts.length >= 5 && parts[3] === 'sessions') {
    const auth = await access(group, request);
    const session = group.sessions.find(entry => entry.id === parts[4]);
    if (!session) fail(404, 'Учасника не знайдено.');
    if (request.method === 'DELETE' && parts.length === 5) {
      if (auth.role !== 'owner') fail(403, 'Дія доступна лише організатору.');
      if (session.type === 'Owner') fail(400, 'Організатора не можна видалити.');
      if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
      group.sessions = group.sessions.filter(entry => entry.id !== session.id);
      await saveGroup(env.BUCKET, group, etag);
      const participants = group.sessions.map(participant);
      return json(200, { participants, total: participants.reduce((sum, person) => sum + person.total, 0) });
    }
    if (auth.session.id !== session.id) fail(403, 'Не можна змінювати чужий кошик.');
    if (group.status !== 'Open' || session.submitted) fail(409, 'Кошик уже підтверджено або замовлення закрито.');
    if (request.method === 'PUT' && parts.length === 6 && parts[5] === 'cart') {
      session.items = validateItems((await body(request)).items);
      await saveGroup(env.BUCKET, group, etag);
      return json(200, snapshot(group, auth));
    }
    if (request.method === 'POST' && parts.length === 6 && parts[5] === 'submit') {
      if (!session.items.length) fail(400, 'Додайте хоча б одну страву.');
      const conflicts = participant(session).items.flatMap(item => item.dish.allergens.filter(allergen => session.avoid.includes(allergen)));
      if (conflicts.length) fail(400, `Перевірте алергени у своєму кошику: ${[...new Set(conflicts)].join(', ')}.`);
      session.submitted = true; await saveGroup(env.BUCKET, group, etag);
      return json(200, snapshot(group, auth));
    }
  }
  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'submit') {
    const auth = await owner(group, request);
    if (group.status !== 'Open') fail(409, 'Групове замовлення вже підтверджено.');
    const submitted = group.sessions.filter(session => session.submitted);
    if (!submitted.length) fail(400, 'Немає підтверджених кошиків.');
    const quantities = new Map();
    for (const session of submitted) for (const item of session.items) quantities.set(item.dishId, (quantities.get(item.dishId) || 0) + item.quantity);
    if (!quantities.size) fail(400, 'Підтверджені кошики порожні.');
    const items = [...quantities].map(([dishId, quantity]) => ({ dishId, quantity }));
    group.order = { status: 'SubmittedByCustomer', items, submittedAt: new Date().toISOString() };
    group.status = 'Submitted'; await saveGroup(env.BUCKET, group, etag);
    return json(200, { items, group: snapshot(group, auth) });
  }
  fail(404, 'Маршрут не знайдено.');
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) {
      if (!error.status) console.error(error);
      return json(error.status || 500, { error: error.status ? error.message : 'Внутрішня помилка сервера.' });
    }
  }
};
