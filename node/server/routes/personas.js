import { requireAdmin, requireUser } from '../lib/auth.js';
import {
  createPersona,
  deletePersona,
  listAllPersonas,
  listPersonasFor,
  updatePersona,
  toPublicPersona,
} from '../lib/personas.js';

export default async function personaRoutes(app) {
  /* ── 普通用户：可用角色列表 ─────────────────────────── */
  app.get('/api/personas', async (request, reply) => {
    const user = await requireUser(request);
    return reply.send({ ok: true, ...listPersonasFor(user) });
  });

  /* ── 管理自己的角色 ─────────────────────────────────── */
  app.get('/api/personas/mine', async (request, reply) => {
    const user = await requireUser(request);
    return reply.send({ ok: true, personas: listAllPersonas('user', user.id) });
  });

  app.post('/api/personas', async (request, reply) => {
    const user = await requireUser(request);
    const b = request.body || {};
    const row = createPersona({
      ownerType: 'user',
      ownerId: user.id,
      name: b.name,
      description: b.description,
      prompt: b.prompt,
    });
    return reply.send({ ok: true, persona: toPublicPersona(row) });
  });

  app.put('/api/personas/:id', async (request, reply) => {
    const user = await requireUser(request);
    const row = updatePersona({
      id: request.params.id,
      ownerType: 'user',
      ownerId: user.id,
      patch: request.body || {},
    });
    return reply.send({ ok: true, persona: toPublicPersona(row) });
  });

  app.delete('/api/personas/:id', async (request, reply) => {
    const user = await requireUser(request);
    deletePersona({ id: request.params.id, ownerType: 'user', ownerId: user.id });
    return reply.send({ ok: true });
  });

  /* ── 管理员：全局角色 ───────────────────────────────── */
  app.get('/api/admin/personas', async (request, reply) => {
    await requireAdmin(request);
    return reply.send({ ok: true, personas: listAllPersonas('global', null) });
  });

  app.post('/api/admin/personas', async (request, reply) => {
    await requireAdmin(request);
    const b = request.body || {};
    const row = createPersona({
      ownerType: 'global',
      ownerId: null,
      name: b.name,
      description: b.description,
      prompt: b.prompt,
      sort: b.sort,
    });
    return reply.send({ ok: true, persona: toPublicPersona(row) });
  });

  app.put('/api/admin/personas/:id', async (request, reply) => {
    await requireAdmin(request);
    const row = updatePersona({
      id: request.params.id,
      ownerType: 'global',
      ownerId: null,
      patch: request.body || {},
    });
    return reply.send({ ok: true, persona: toPublicPersona(row) });
  });

  app.delete('/api/admin/personas/:id', async (request, reply) => {
    await requireAdmin(request);
    deletePersona({ id: request.params.id, ownerType: 'global', ownerId: null });
    return reply.send({ ok: true });
  });
}
