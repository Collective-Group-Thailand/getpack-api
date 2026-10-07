import { ApiProperty } from '@nestjs/swagger';

import { type LabelledEnum, STATUS_LABELS, type StatusLabel } from './status-labels';

function first(enumName: LabelledEnum): StatusLabel {
  return Object.values(STATUS_LABELS[enumName] as Record<string, StatusLabel>)[0]!;
}

/** `<field>LabelTh`: the status in the customer's words (D-313, glossary; never a factory, D-050). */
export function ApiStatusLabelTh(enumName: LabelledEnum, field = 'status', nullable = false) {
  return ApiProperty({
    type: String,
    nullable,
    example: first(enumName).th,
    description: `\`${field}\` (${enumName}) in Thai for the customer — render this, not a label map of your own (D-313). The enum value in \`${field}\` never changes.${nullable ? ` Null when \`${field}\` is null.` : ''}`,
  });
}

/** `<field>LabelAdminTh`: the status in the back office's and factories' words ("Proof", factory steps). */
export function ApiStatusLabelAdminTh(enumName: LabelledEnum, field = 'status', nullable = false) {
  return ApiProperty({
    type: String,
    nullable,
    example: first(enumName).adminTh,
    description: `\`${field}\` (${enumName}) in Thai for staff and partner factories (D-313).`,
  });
}
