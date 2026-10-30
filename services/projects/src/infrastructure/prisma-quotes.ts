import { Prisma, PrismaClient } from '@prisma/client';
import { QuoteForbiddenError, QuoteNotFoundError, QuoteStateError } from '../domain/errors';
import { milestoneCreated, QUOTE_APPROVED_ROUTING_KEY, quoteApproved, MILESTONE_CREATED_ROUTING_KEY } from '../domain/events';
import { newMilestone } from '../domain/milestone';
import { newProject } from '../domain/project';
import { assertReadyToSubmit, DEFAULT_MARGIN_PCT, priceQuote, QuoteContent, QuoteLine, quoteLabel, QuoteStatus, validateQuoteContent } from '../domain/quote';

const TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 } as const;
export type Actor = { email: string; role: string };
const isManager = (a: Actor) => a.role === 'manager';

/**
 * Cotizaciones. Toda acción que cambia el estado BLOQUEA la fila de la cotización (FOR UPDATE) y relee el estado dentro del bloqueo:
 * dos aprobaciones a la vez crean un solo proyecto; editar mientras otro aprueba espera y luego se rechaza por el estado.
 * Ventas solo toca sus cotizaciones; gerencia toca todas.
 */
export class QuotesService {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  private async load(tx: Prisma.TransactionClient, id: string, lock: boolean) {
    const rows = lock
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quotes WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quotes WHERE id = ${id}::uuid`;
    if (rows.length === 0) throw new QuoteNotFoundError();
    return tx.quote.findUniqueOrThrow({ where: { id }, include: { milestones: { orderBy: { position: 'asc' }, include: { lines: { orderBy: { position: 'asc' } } } } } });
  }
  private mine(q: { createdBy: string }, a: Actor) { if (!isManager(a) && q.createdBy !== a.email) throw new QuoteForbiddenError(); }

  private content(q: Awaited<ReturnType<QuotesService['load']>>): QuoteContent {
    return {
      client: q.client, projectName: q.projectName, marginPct: q.marginPct,
      milestones: q.milestones.map((m) => ({ name: m.name, lines: m.lines.map((l): QuoteLine => ({ category: l.category as QuoteLine['category'], description: l.description, quantity: l.quantity, unitCostCop: l.unitCostCop, ref: l.ref })) })),
    };
  }

  private view(q: Awaited<ReturnType<QuotesService['load']>>) {
    const priced = priceQuote(this.content(q));
    return {
      id: q.id, number: quoteLabel(q.number), status: q.status as QuoteStatus, client: q.client, projectName: q.projectName, marginPct: q.marginPct,
      createdBy: q.createdBy, createdAt: q.createdAt.toISOString(), submittedAt: q.submittedAt?.toISOString() ?? null, decidedBy: q.decidedBy, decidedAt: q.decidedAt?.toISOString() ?? null, decisionNote: q.decisionNote, projectId: q.projectId,
      costCop: priced.costCop, priceCop: priced.priceCop, profitCop: priced.profitCop, lowMargin: priced.lowMargin, byCategory: priced.byCategory,
      milestones: priced.milestones.map((m) => ({ name: m.name, costCop: m.costCop, priceCop: m.priceCop, byCategory: m.byCategory, lines: m.lines })),
    };
  }

  async create(clientRaw: unknown, projectNameRaw: unknown, actor: Actor) {
    const c = validateQuoteContent({ client: clientRaw, projectName: projectNameRaw });
    const q = await this.prisma.quote.create({ data: { client: c.client, projectName: c.projectName, marginPct: DEFAULT_MARGIN_PCT, createdBy: actor.email }, include: { milestones: { include: { lines: true } } } });
    return this.view(q);
  }

  async list(actor: Actor) {
    const rows = await this.prisma.quote.findMany({ where: isManager(actor) || actor.role === 'project_lead' ? {} : { createdBy: actor.email }, orderBy: [{ number: 'desc' }], take: 200, include: { milestones: { orderBy: { position: 'asc' }, include: { lines: { orderBy: { position: 'asc' } } } } } });
    return rows.map((q) => this.view(q));
  }

  async get(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => { const q = await this.load(tx, id, false); if (actor.role !== 'project_lead') this.mine(q, actor); return this.view(q); }, TX);
  }

  /** Reemplaza TODO el contenido (cliente, proyecto, margen, hitos y líneas). Solo en borrador o rechazada; una rechazada vuelve a borrador. */
  async save(id: string, raw: Record<string, unknown>, actor: Actor) {
    const content = validateQuoteContent(raw);
    return this.prisma.$transaction(async (tx) => {
      const q = await this.load(tx, id, true);
      this.mine(q, actor);
      if (q.status !== 'draft' && q.status !== 'rejected') throw new QuoteStateError(`The quote is ${q.status}: it cannot be edited`);
      await tx.quoteMilestone.deleteMany({ where: { quoteId: id } });
      await tx.quote.update({ where: { id }, data: { client: content.client, projectName: content.projectName, marginPct: content.marginPct, status: 'draft', decidedBy: null, decidedAt: null, decisionNote: null } });
      for (const [i, m] of content.milestones.entries()) {
        const created = await tx.quoteMilestone.create({ data: { quoteId: id, position: i + 1, name: m.name } });
        if (m.lines.length) await tx.quoteLine.createMany({ data: m.lines.map((l, k) => ({ milestoneId: created.id, position: k + 1, category: l.category, description: l.description, quantity: l.quantity, unitCostCop: l.unitCostCop, ref: l.ref })) });
      }
      return this.view(await this.load(tx, id, false));
    }, TX);
  }

  async submit(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const q = await this.load(tx, id, true);
      this.mine(q, actor);
      if (q.status !== 'draft') throw new QuoteStateError(`The quote is ${q.status}: only a draft can be sent for approval`);
      assertReadyToSubmit(this.content(q));
      await tx.quote.update({ where: { id }, data: { status: 'pending', submittedAt: this.clock() } });
      return this.view(await this.load(tx, id, false));
    }, TX);
  }

  async reject(id: string, noteRaw: unknown, actor: Actor) {
    const note = typeof noteRaw === 'string' ? noteRaw.replace(/\s+/g, ' ').trim() : '';
    // eslint-disable-next-line no-control-regex
    if (note.length < 3 || note.length > 300 || /[\u0000-\u001f<>]/.test(note)) throw new QuoteStateError('A rejection needs a reason of 3 to 300 characters');
    return this.prisma.$transaction(async (tx) => {
      const q = await this.load(tx, id, true);
      if (q.status !== 'pending') throw new QuoteStateError(`The quote is ${q.status}: only a pending one can be rejected`);
      await tx.quote.update({ where: { id }, data: { status: 'rejected', decidedBy: actor.email, decidedAt: this.clock(), decisionNote: note } });
      return this.view(await this.load(tx, id, false));
    }, TX);
  }

  /** Aprobar: nacen el proyecto, sus hitos (cada uno con su evento MilestoneCreated) y el evento QuoteApproved, todo en UNA transacción. */
  async approve(id: string, actor: Actor, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const q = await this.load(tx, id, true);
      if (q.status !== 'pending') throw new QuoteStateError(`The quote is ${q.status}: only a pending one can be approved`);
      const content = this.content(q);
      assertReadyToSubmit(content);
      const priced = priceQuote(content);
      const now = this.clock();
      const project = newProject(content.projectName, content.client);
      await tx.project.create({ data: { id: project.id, name: project.name, client: project.client } });
      for (const m of priced.milestones) {
        const ms = newMilestone(project.id, m.name, m.priceCop);
        await tx.milestone.create({ data: { id: ms.id, projectId: ms.projectId, name: ms.name, amountCop: ms.amountCop, status: 'pending' } });
        const ev = milestoneCreated(ms, project.name, correlationId, now);
        await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: ms.id, type: ev.type, routingKey: MILESTONE_CREATED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      }
      const ev = quoteApproved({ quoteId: q.id, quoteNumber: quoteLabel(q.number), clientName: project.client, projectId: project.id, projectName: project.name, amountCop: priced.priceCop, costCop: priced.costCop, marginPct: priced.marginPct, approvedBy: actor.email }, correlationId, now);
      await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: q.id, type: ev.type, routingKey: QUOTE_APPROVED_ROUTING_KEY, payload: ev as unknown as Prisma.InputJsonValue } });
      await tx.quote.update({ where: { id }, data: { status: 'approved', decidedBy: actor.email, decidedAt: now, projectId: project.id } });
      return this.view(await this.load(tx, id, false));
    }, TX);
  }
}
