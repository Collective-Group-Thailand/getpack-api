import { LookupHasher } from '@common/crypto/lookup-hasher';
import { type Tx } from '@database/prisma.service';
import { type FingerprintKind } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

/**
 * Identity matching for abuse controls (D-053 per-phone / device limits, D-136 referral fraud rules):
 * keyed hashes (HMAC-SHA256, `LOOKUP_HMAC_SECRET`) of a customer's phone, delivery addresses and device
 * ids, so two accounts of one person can be linked without storing the values themselves (PDPA).
 */
@Injectable()
export class IdentityFingerprints {
  constructor(private readonly hasher: LookupHasher) {}

  hashOf(kind: FingerprintKind, value: string): Uint8Array<ArrayBuffer> {
    return kind === 'address'
      ? this.hasher.hashText(value, `fingerprint:${kind}`)
      : this.hasher.hash(value, `fingerprint:${kind}`);
  }

  async record(
    tx: Tx,
    userId: bigint,
    kind: FingerprintKind,
    value: string | null | undefined,
  ): Promise<void> {
    if (!value || !value.trim()) return;
    const valueHash = this.hashOf(kind, value);
    await tx.identityFingerprint.upsert({
      where: { userId_kind_valueHash: { userId, kind, valueHash } },
      create: { userId, kind, valueHash },
      update: { lastSeenAt: new Date() },
    });
  }

  /** Other accounts sharing any fingerprint with this customer. */
  async relatedUserIds(tx: Tx, userId: bigint): Promise<bigint[]> {
    const rows = await tx.$queryRaw<{ user_id: bigint }[]>`
      SELECT DISTINCT other.user_id
        FROM identity_fingerprints mine
        JOIN identity_fingerprints other
          ON other.kind = mine.kind AND other.value_hash = mine.value_hash AND other.user_id <> mine.user_id
       WHERE mine.user_id = ${userId}`;
    return rows.map((r) => r.user_id);
  }
}
