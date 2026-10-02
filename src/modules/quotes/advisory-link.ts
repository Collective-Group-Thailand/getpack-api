import { DomainException } from '@common/errors/domain.exception';
import { type PrismaService, type Tx } from '@database/prisma.service';

import { type QuoteOwner } from './saved-quotes.service';

/**
 * D-240: a quotation saved from a Structure Advisor recommendation stores the recommendation and the customer's
 * current choice. Only the recommendation's owner (the customer, or the same anonymous session) may use it; a choice
 * is required, and it must name the configuration's board.
 */
export async function resolveAdvisoryLink(
  db: PrismaService | Tx,
  owner: QuoteOwner,
  recommendationPublicId: string,
  configuration: Record<string, unknown>,
): Promise<{ recommendationId: bigint; choiceId: bigint }> {
  const rec = await db.advisoryRecommendation.findUnique({
    where: { publicId: recommendationPublicId },
    select: {
      id: true,
      customerUserId: true,
      anonymousId: true,
      choices: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { id: true, material: { select: { publicId: true } } },
      },
    },
  });
  const owned =
    rec !== null &&
    ((owner.kind === 'customer' && rec.customerUserId === owner.userId) ||
      (owner.kind === 'anonymous' && rec.customerUserId === null && rec.anonymousId === owner.anonymousId));
  if (!rec || !owned) {
    throw new DomainException('validation.failed', {
      errors: [
        { path: 'advisoryRecommendationId', code: 'exists', message: 'no such recommendation of yours' },
      ],
    });
  }
  const choice = rec.choices[0];
  if (!choice) throw new DomainException('advisory.choice_required');
  if (choice.material.publicId !== configuration['materialId'])
    throw new DomainException('advisory.choice_mismatch');
  return { recommendationId: rec.id, choiceId: choice.id };
}
