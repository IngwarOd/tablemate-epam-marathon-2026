import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const defaultDataFile = resolve(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json');

export const MENU = [
  { id: 'tomato', name: 'Томати й страчатела', category: 'Закуски', price: 245, icon: '🍅', color: 'peach', image: 'https://images.unsplash.com/photo-1753791320863-bda47c67cd00?auto=format&fit=crop&w=900&q=80', allergens: ['Молоко'], description: 'Стиглі томати, базилік, оливкова олія' },
  { id: 'hummus', name: 'Хумус із зеленню', category: 'Закуски', price: 195, icon: '🫘', color: 'sand', image: 'https://images.unsplash.com/photo-1726588551950-7e70637945ff?auto=format&fit=crop&w=900&q=80', allergens: ['Кунжут'], description: 'Нут, тахіні, хрусткі овочі' },
  { id: 'soup', name: 'Гарбузовий крем-суп', category: 'Закуски', price: 185, icon: '🥣', color: 'orange', image: 'https://images.unsplash.com/photo-1680798552307-2cc4ddde8e98?auto=format&fit=crop&w=900&q=80', allergens: ['Молоко'], description: 'Печений гарбуз і насіння' },
  { id: 'pasta', name: 'Паста з грибами', category: 'Основні страви', price: 315, icon: '🍝', color: 'rose', image: 'https://images.unsplash.com/photo-1692296979424-2d337691af6f?auto=format&fit=crop&w=900&q=80', allergens: ['Глютен', 'Молоко'], description: 'Лісові гриби, вершковий соус' },
  { id: 'fish', name: 'Риба з лимоном', category: 'Основні страви', price: 420, icon: '🐟', color: 'blue', image: 'https://images.unsplash.com/photo-1673436977947-0787164a9abc?auto=format&fit=crop&w=900&q=80', allergens: ['Риба'], description: 'Запечена риба, зелений горошок' },
  { id: 'risotto', name: 'Ризото з шафраном', category: 'Основні страви', price: 345, icon: '🍚', color: 'yellow', image: 'https://images.unsplash.com/photo-1682428617976-f25633ed8469?auto=format&fit=crop&w=900&q=80', allergens: ['Молоко'], description: 'Арборіо, шафран, пармезан' },
  { id: 'tofu', name: 'Тофу з овочами', category: 'Основні страви', price: 285, icon: '🥦', color: 'green', image: 'https://images.unsplash.com/photo-1572448910681-3341d74893d2?auto=format&fit=crop&w=900&q=80', allergens: ['Соя'], description: 'Сезонні овочі, імбирний соус' },
  { id: 'cake', name: 'Медовик', category: 'Десерти', price: 175, icon: '🍰', color: 'cream', image: 'https://images.unsplash.com/photo-1710717249738-b6415d69e515?auto=format&fit=crop&w=900&q=80', allergens: ['Глютен', 'Молоко', 'Яйця'], description: 'Тонкі коржі, сметанковий крем' },
  { id: 'pear', name: 'Груша в карамелі', category: 'Десерти', price: 165, icon: '🍐', color: 'mint', image: 'https://images.unsplash.com/photo-1694607094007-cf667adaa6d3?auto=format&fit=crop&w=900&q=80', allergens: [], description: 'Тепла груша, прянощі, сорбет' }
];
const ALLERGENS = ['Глютен', 'Молоко', 'Яйця', 'Риба', 'Соя', 'Кунжут'];
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function token() { return randomBytes(32).toString('base64url'); }
function hash(value) { return createHash('sha256').update(value).digest(); }
function sameToken(provided, storedHash) {
  return typeof provided === 'string' && typeof storedHash === 'string' &&
    timingSafeEqual(hash(provided), Buffer.from(storedHash, 'hex'));
}
function text(value, label, max = 50) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}: введіть від 1 до ${max} символів.`);
  return value.trim();
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label}: допустиме значення від ${min} до ${max}.`);
  return value;
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) fail(413, 'Завеликий запит.');
  }
  let parsed;
  try { parsed = JSON.parse(raw || '{}'); } catch { fail(400, 'Некоректний JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Очікується JSON-об’єкт.');
  return parsed;
}
function bearer(req) {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
}
function findGroup(store, id) {
  const group = store.groups.find(entry => entry.id === id);
  if (!group) fail(404, 'Групу не знайдено.');
  return group;
}
function access(group, req) {
  const credential = bearer(req);
  if (sameToken(credential, group.ownerTokenHash)) return { role: 'owner', session: group.sessions.find(s => s.type === 'Owner') };
  const session = group.sessions.find(s => sameToken(credential, s.tokenHash));
  if (session) return { role: 'guest', session };
  fail(403, 'Немає доступу до цієї групи.');
}
function owner(group, req) {
  const auth = access(group, req);
  if (auth.role !== 'owner') fail(403, 'Дія доступна лише організатору.');
  return auth;
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

export function createApp({ dataFile = defaultDataFile } = {}) {
  let store = { groups: [] };
  if (existsSync(dataFile)) store = JSON.parse(readFileSync(dataFile, 'utf8'));
  function save() {
    mkdirSync(dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(temporary, dataFile);
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'api') {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Метод не підтримується.');
        const pathname = ['/', '/join', '/kitchen'].includes(url.pathname) ? '/index.html' : url.pathname;
        const path = resolve(publicDir, `.${pathname}`);
        if (!path.startsWith(publicDir + sep) || !existsSync(path) || !statSync(path).isFile()) fail(404, 'Файл не знайдено.');
        res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        if (req.method === 'HEAD') res.end(); else createReadStream(path).pipe(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/menu') return json(res, 200, { dishes: MENU, allergens: ALLERGENS });
      if (req.method === 'POST' && url.pathname === '/api/groups') {
        const input = await body(req);
        if (typeof input.serviceAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.serviceAt)) fail(400, 'Дата має містити часовий пояс.');
        const serviceAt = new Date(input.serviceAt);
        if (!Number.isFinite(serviceAt.getTime()) || serviceAt.getTime() < Date.now() - 60_000) fail(400, 'Оберіть майбутню дату зустрічі.');
        const timeZone = typeof input.timeZone === 'string' ? input.timeZone : 'UTC';
        if (timeZone.length > 100) fail(400, 'Некоректний часовий пояс.');
        try { new Intl.DateTimeFormat('en', { timeZone }); } catch { fail(400, 'Некоректний часовий пояс.'); }
        const utcOffsetMinutes = input.utcOffsetMinutes === undefined ? 0 : integer(input.utcOffsetMinutes, 'Зсув часового поясу', -840, 840);
        const ownerName = text(input.ownerName, 'Ім’я організатора');
        const ownerToken = token();
        const kitchenToken = token();
        const group = {
          id: randomUUID(), title: text(input.title, 'Назва зустрічі', 80), serviceAt: serviceAt.toISOString(), timeZone, utcOffsetMinutes,
          guestLimit: integer(input.guestLimit, 'Кількість гостей', 2, 20), budget: integer(input.budget, 'Бюджет', 100, 100_000),
          status: 'Open', ownerTokenHash: hash(ownerToken).toString('hex'), kitchenTokenHash: hash(kitchenToken).toString('hex'), inviteCode: token(), order: null,
          sessions: [{ id: randomUUID(), type: 'Owner', name: ownerName, avoid: [], items: [], submitted: false, tokenHash: hash(ownerToken).toString('hex') }]
        };
        store.groups.push(group); save();
        return json(res, 201, { group: snapshot(group, { role: 'owner', session: group.sessions[0] }), token: ownerToken, kitchenToken });
      }
      if (parts[1] !== 'groups' || !parts[2]) fail(404, 'Маршрут не знайдено.');
      const group = findGroup(store, parts[2]);
      if (req.method === 'GET' && parts.length === 4 && parts[3] === 'kitchen') {
        if (!sameToken(bearer(req), group.kitchenTokenHash)) fail(403, 'Немає доступу до кухонного талона.');
        return json(res, 200, { title: group.title, serviceAt: group.serviceAt, timeZone: group.timeZone, utcOffsetMinutes: group.utcOffsetMinutes, status: group.status, order: group.order });
      }
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
        const input = await body(req);
        if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
        if (input.inviteCode !== group.inviteCode) fail(403, 'Недійсне запрошення.');
        if (group.sessions.length >= group.guestLimit) fail(409, 'Усі місця за столом зайняті.');
        const guestToken = token();
        const avoid = input.avoid ?? [];
        if (!Array.isArray(avoid) || avoid.some(a => !ALLERGENS.includes(a)) || new Set(avoid).size !== avoid.length) fail(400, 'Некоректні харчові обмеження.');
        const session = { id: randomUUID(), type: 'Guest', name: text(input.name, 'Ім’я гостя'), avoid, items: [], submitted: false, tokenHash: hash(guestToken).toString('hex') };
        group.sessions.push(session); save();
        return json(res, 201, { group: snapshot(group, { role: 'guest', session }), token: guestToken });
      }
      if (req.method === 'GET' && parts.length === 3) return json(res, 200, snapshot(group, access(group, req)));
      if (req.method === 'GET' && parts.length === 4 && parts[3] === 'sessions') {
        owner(group, req);
        const participants = group.sessions.map(participant);
        return json(res, 200, { participants, total: participants.reduce((sum, p) => sum + p.total, 0) });
      }
      if (req.method === 'PATCH' && parts.length === 4 && parts[3] === 'budget') {
        owner(group, req);
        if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
        group.budget = integer((await body(req)).budget, 'Бюджет', 100, 100_000); save();
        return json(res, 200, snapshot(group, access(group, req)));
      }
      if (parts.length >= 5 && parts[3] === 'sessions') {
        const auth = access(group, req);
        const session = group.sessions.find(s => s.id === parts[4]);
        if (!session) {
          if (store.groups.some(other => other.id !== group.id && other.sessions.some(s => s.id === parts[4]))) fail(400, 'Учасник належить іншій групі.');
          fail(404, 'Учасника не знайдено.');
        }
        if (req.method === 'DELETE' && parts.length === 5) {
          if (auth.role !== 'owner') fail(403, 'Дія доступна лише організатору.');
          if (session.type === 'Owner') fail(400, 'Організатора не можна видалити.');
          if (group.status !== 'Open') fail(409, 'Замовлення вже закрито.');
          group.sessions = group.sessions.filter(s => s.id !== session.id); save();
          const participants = group.sessions.map(participant);
          return json(res, 200, { participants, total: participants.reduce((sum, p) => sum + p.total, 0) });
        }
        if (auth.session.id !== session.id) fail(403, 'Не можна змінювати чужий кошик.');
        if (group.status !== 'Open' || session.submitted) fail(409, 'Кошик уже підтверджено або замовлення закрито.');
        if (req.method === 'PUT' && parts.length === 6 && parts[5] === 'cart') {
          session.items = validateItems((await body(req)).items); save();
          return json(res, 200, snapshot(group, auth));
        }
        if (req.method === 'POST' && parts.length === 6 && parts[5] === 'submit') {
          if (session.items.length === 0) fail(400, 'Додайте хоча б одну страву.');
          const conflicts = participant(session).items.flatMap(item => item.dish.allergens.filter(a => session.avoid.includes(a)));
          if (conflicts.length) fail(400, `Перевірте алергени у своєму кошику: ${[...new Set(conflicts)].join(', ')}.`);
          session.submitted = true; save();
          return json(res, 200, snapshot(group, auth));
        }
      }
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'submit') {
        owner(group, req);
        if (group.status !== 'Open') fail(409, 'Групове замовлення вже підтверджено.');
        const submitted = group.sessions.filter(s => s.submitted);
        if (!submitted.length) fail(400, 'Немає підтверджених кошиків.');
        const quantities = new Map();
        for (const session of submitted) for (const item of session.items) quantities.set(item.dishId, (quantities.get(item.dishId) || 0) + item.quantity);
        if (!quantities.size) fail(400, 'Підтверджені кошики порожні.');
        const items = [...quantities].map(([dishId, quantity]) => ({ dishId, quantity }));
        group.order = { status: 'SubmittedByCustomer', items, submittedAt: new Date().toISOString() };
        group.status = 'Submitted'; save();
        return json(res, 200, { items, group: snapshot(group, access(group, req)) });
      }
      fail(404, 'Маршрут не знайдено.');
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : 'Внутрішня помилка сервера.' });
      if (!error.status) console.error(error);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ dataFile: process.env.DATA_FILE || defaultDataFile }).listen(port, '0.0.0.0', () => console.log(`Tablemate: http://localhost:${port}`));
}
