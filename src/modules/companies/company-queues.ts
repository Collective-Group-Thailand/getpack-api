import { type Prisma } from '@generated/prisma/client';

/** The `admin.companies.list` filter, shared with the dashboard's KYC card (`status=kyc_review`, D-120). */
export function companyListWhere(q: {
  status?: Prisma.CompanyWhereInput['status'];
  creditStatus?: Prisma.CompanyWhereInput['creditStatus'];
  q?: string;
}): Prisma.CompanyWhereInput {
  return {
    ...(q.status && { status: q.status }),
    ...(q.creditStatus && { creditStatus: q.creditStatus }),
    ...(q.q && {
      OR: [
        { taxId: q.q },
        { companyCode: { equals: q.q, mode: 'insensitive' as const } },
        { legalName: { contains: q.q, mode: 'insensitive' as const } },
      ],
    }),
  };
}
