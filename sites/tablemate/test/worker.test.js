import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

function bucket() {
  const objects = new Map();
  return {
    async get(key) {
      const item = objects.get(key);
      return item && { etag: item.etag, json: async () => JSON.parse(item.value) };
    },
    async put(key, value, options) {
      const old = objects.get(key);
      if (options.onlyIf instanceof Headers && old) return null;
      if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
      const etag = crypto.randomUUID();
      objects.set(key, { value, etag });
      return { etag };
    }
  };
}

test('hosted worker serves the app and preserves the group order flow', async () => {
  const env = { BUCKET: bucket() };
  const call = async (path, method = 'GET', data, token = '') => {
    const response = await worker.fetch(new Request(`https://tablemate.test${path}`, {
      method, headers: { ...(token && { authorization: `Bearer ${token}` }), ...(data && { 'content-type': 'application/json' }) },
      body: data ? JSON.stringify(data) : undefined
    }), env);
    return { status: response.status, data: await response.json() };
  };
  const page = await worker.fetch(new Request('https://tablemate.test/'), env);
  assert.match(await page.text(), /Tablemate/);
  const created = await call('/api/groups', 'POST', {
    title: 'Тестова вечеря', ownerName: 'Ігор', serviceAt: new Date(Date.now() + 86_400_000).toISOString(),
    timeZone: 'Europe/Kyiv', utcOffsetMinutes: 120, guestLimit: 4, budget: 1000
  });
  assert.equal(created.status, 201);
  const id = created.data.group.id;
  const ownerToken = created.data.token;
  const joined = await call(`/api/groups/${id}/join`, 'POST', { inviteCode: created.data.group.inviteCode, name: 'Олена', avoid: [] });
  assert.equal(joined.status, 201);
  const guestId = joined.data.group.mySessionId;
  const guestToken = joined.data.token;
  assert.equal((await call(`/api/groups/${id}`, 'GET', undefined, guestToken)).data.group, undefined);
  assert.equal((await call(`/api/groups/${id}`, 'GET', undefined, guestToken)).data.participants.length, 1);
  assert.equal((await call(`/api/groups/${id}/sessions/${guestId}/cart`, 'PUT', { items: [{ dishId: 'tofu', quantity: 2 }] }, guestToken)).status, 200);
  assert.equal((await call(`/api/groups/${id}/sessions/${guestId}/submit`, 'POST', undefined, guestToken)).status, 200);
  const submitted = await call(`/api/groups/${id}/submit`, 'POST', undefined, ownerToken);
  assert.equal(submitted.status, 200);
  assert.deepEqual(submitted.data.items, [{ dishId: 'tofu', quantity: 2 }]);
  const kitchen = await call(`/api/groups/${id}/kitchen`, 'GET', undefined, created.data.kitchenToken);
  assert.equal(kitchen.data.order.status, 'SubmittedByCustomer');
  assert.equal((await call(`/api/groups/${id}`, 'GET', undefined, 'wrong')).status, 403);
  assert.equal((await call(`/api/groups/${id}/submit`, 'POST', undefined, ownerToken)).status, 409);
});
