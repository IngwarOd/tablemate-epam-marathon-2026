import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function fixture() {
  const dataFile = join(tmpdir(), `tablemate-${randomUUID()}.json`);
  const server = createApp({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', data, token } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined
    });
    return { status: response.status, body: await response.json() };
  }
  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (existsSync(dataFile)) unlinkSync(dataFile);
  }
  return { request, close, dataFile, server, base };
}
async function createGroup(request, ownerName = 'Igor') {
  const response = await request('/api/groups', { method: 'POST', data: {
    title: 'Test dinner', ownerName, serviceAt: new Date(Date.now() + 86_400_000).toISOString(), timeZone: 'Europe/Kyiv', utcOffsetMinutes: 120, guestLimit: 5, budget: 500
  } });
  assert.equal(response.status, 201);
  return response.body;
}
async function joinGroup(request, group, name, avoid = []) {
  const response = await request(`/api/groups/${group.id}/join`, { method: 'POST', data: { inviteCode: group.inviteCode, name, avoid } });
  assert.equal(response.status, 201);
  return response.body;
}

test('owner consolidates only submitted carts; budget and allergen advice use real cart data', async () => {
  const { request, close } = await fixture();
  try {
    const created = await createGroup(request);
    const group = created.group;
    assert.equal(group.timeZone, 'Europe/Kyiv');
    assert.equal(group.utcOffsetMinutes, 120);
    assert.equal((await request(`/api/groups/${group.id}/kitchen`)).status, 403);
    assert.equal((await request(`/api/groups/${group.id}/kitchen`, { token: created.kitchenToken })).body.status, 'Open');
    const guest = await joinGroup(request, group, 'Olena', ['Молоко']);
    const waiting = await joinGroup(request, group, 'Marko');
    const guestId = guest.group.mySessionId;
    const ownerId = group.mySessionId;
    const waitingId = waiting.group.mySessionId;
    let result = await request(`/api/groups/${group.id}/sessions/${guestId}/cart`, { method: 'PUT', token: guest.token, data: { items: [{ dishId: 'tomato', quantity: 1 }] } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.participants[0].items[0].dish.allergens, ['Молоко']);
    result = await request(`/api/groups/${group.id}/sessions/${guestId}/submit`, { method: 'POST', token: guest.token });
    assert.equal(result.status, 400);
    result = await request(`/api/groups/${group.id}/sessions/${guestId}/cart`, { method: 'PUT', token: guest.token, data: { items: [{ dishId: 'pear', quantity: 2 }] } });
    assert.equal(result.status, 200);
    result = await request(`/api/groups/${group.id}/sessions/${guestId}/submit`, { method: 'POST', token: guest.token });
    assert.equal(result.status, 200);
    result = await request(`/api/groups/${group.id}/sessions/${ownerId}/cart`, { method: 'PUT', token: created.token, data: { items: [{ dishId: 'pear', quantity: 1 }] } });
    assert.equal(result.status, 200);
    result = await request(`/api/groups/${group.id}/sessions/${ownerId}/submit`, { method: 'POST', token: created.token });
    assert.equal(result.status, 200);
    result = await request(`/api/groups/${group.id}/sessions/${waitingId}/cart`, { method: 'PUT', token: waiting.token, data: { items: [{ dishId: 'fish', quantity: 1 }] } });
    assert.equal(result.status, 200);
    result = await request(`/api/groups/${group.id}`, { token: created.token });
    assert.equal(result.body.insights.total, 915);
    assert.equal(result.body.insights.submittedTotal, 495);
    assert.equal(result.body.insights.remaining, -415);
    assert.deepEqual(result.body.insights.waiting, ['Marko']);
    assert.ok(result.body.insights.swap?.saving > 0);
    result = await request(`/api/groups/${group.id}/submit`, { method: 'POST', token: created.token });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.items, [{ dishId: 'pear', quantity: 3 }]);
    assert.equal(result.body.group.status, 'Submitted');
    assert.equal(result.body.group.order.status, 'SubmittedByCustomer');
    const kitchen = await request(`/api/groups/${group.id}/kitchen`, { token: created.kitchenToken });
    assert.equal(kitchen.status, 200);
    assert.deepEqual(kitchen.body.order.items, [{ dishId: 'pear', quantity: 3 }]);
    assert.equal(kitchen.body.timeZone, 'Europe/Kyiv');
    assert.equal(kitchen.body.utcOffsetMinutes, 120);
    assert.equal(kitchen.body.ownerTokenHash, undefined);
    assert.equal((await request(`/api/groups/${group.id}/submit`, { method: 'POST', token: created.token })).status, 409);
    assert.equal((await request(`/api/groups/${group.id}/join`, { method: 'POST', data: { inviteCode: group.inviteCode, name: 'Late' } })).status, 409);
  } finally { await close(); }
});

test('only owner can inspect the group or remove its guests; invalid carts are rejected', async () => {
  const { request, close } = await fixture();
  try {
    const first = await createGroup(request);
    const second = await createGroup(request, 'Other');
    const guest = await joinGroup(request, first.group, 'Olena');
    const otherGuest = await joinGroup(request, second.group, 'Taras');
    const path = `/api/groups/${first.group.id}/sessions`;
    assert.equal((await request(path)).status, 403);
    assert.equal((await request(path, { token: guest.token })).status, 403);
    assert.equal((await request(path, { token: second.token })).status, 403);
    assert.equal((await request(path, { token: first.token })).status, 200);
    assert.equal((await request(`/api/groups/${first.group.id}/sessions/${guest.group.mySessionId}/cart`, { method: 'PUT', token: guest.token, data: { items: [{ dishId: 'fish', quantity: 0 }] } })).status, 400);
    assert.equal((await request(`/api/groups/${first.group.id}/sessions/${guest.group.mySessionId}/cart`, { method: 'PUT', token: guest.token, data: { items: [{ dishId: 'fish', quantity: 1 }, { dishId: 'fish', quantity: 1 }] } })).status, 400);
    assert.equal((await request(`/api/groups/${first.group.id}/sessions/${otherGuest.group.mySessionId}`, { method: 'DELETE', token: first.token })).status, 400);
    assert.equal((await request(`/api/groups/${first.group.id}/sessions/not-found`, { method: 'DELETE', token: first.token })).status, 404);
    assert.equal((await request(`/api/groups/${first.group.id}/sessions/${guest.group.mySessionId}`, { method: 'DELETE', token: guest.token })).status, 403);
    const removed = await request(`/api/groups/${first.group.id}/sessions/${guest.group.mySessionId}`, { method: 'DELETE', token: first.token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.total, 0);
    assert.equal(removed.body.participants.length, 1);
  } finally { await close(); }
});

test('invite, budget and submission boundaries keep guest access separate from owner access', async () => {
  const { request, close, base } = await fixture();
  try {
    const created = await createGroup(request);
    const group = created.group;
    assert.equal((await request(`/api/groups/${group.id}/join`, { method: 'POST', data: { inviteCode: 'wrong', name: 'Guest' } })).status, 403);
    const guest = await joinGroup(request, group, 'Olena', ['Риба']);
    assert.equal((await request(`/api/groups/${group.id}/submit`, { method: 'POST', token: created.token })).status, 400);
    assert.equal((await request(`/api/groups/${group.id}/submit`, { method: 'POST', token: guest.token })).status, 403);
    assert.equal((await request(`/api/groups/${group.id}/budget`, { method: 'PATCH', token: guest.token, data: { budget: 900 } })).status, 403);
    const updated = await request(`/api/groups/${group.id}/budget`, { method: 'PATCH', token: created.token, data: { budget: 900 } });
    assert.equal(updated.body.budget, 900);
    const guestView = await request(`/api/groups/${group.id}`, { token: guest.token });
    assert.equal(guestView.body.participants.length, 1);
    assert.equal(guestView.body.inviteCode, undefined);
    assert.equal(guestView.body.insights, undefined);
    assert.equal((await request(`/api/groups/${group.id}/kitchen`, { token: guest.token })).status, 403);
    const kitchenPage = await fetch(`${base}/kitchen`);
    assert.equal(kitchenPage.status, 200);
    assert.match(await kitchenPage.text(), /app\.js/);
    assert.equal(kitchenPage.headers.get('referrer-policy'), 'no-referrer');
  } finally { await close(); }
});

test('groups survive server restart', async () => {
  const { request, close, dataFile, server } = await fixture();
  const created = await createGroup(request);
  await new Promise(resolve => server.close(resolve));
  const restarted = createApp({ dataFile });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/groups/${created.group.id}`, { headers: { authorization: `Bearer ${created.token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, 'Test dinner');
  } finally {
    await new Promise(resolve => restarted.close(resolve));
    if (existsSync(dataFile)) unlinkSync(dataFile);
  }
});
