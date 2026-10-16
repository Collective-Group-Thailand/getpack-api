/**
 * Obviously fake personal data for OpenAPI examples (contract §5, PDPA): the forms
 * `getpack-no-real-personal-data` accepts (`contract/spectral/README.md`). Use these in new examples
 * instead of inventing values.
 */
export const FAKE = {
  name: 'Somchai Test',
  nameTh: 'ลูกค้า ทดสอบ',
  phone: '081-000-1234',
  email: 'test@example.com',
  taxId: '0000000000001',
  companyName: 'บริษัท ตัวอย่าง จำกัด',
  addressLine: '99/9 ถนนตัวอย่าง',
  postcode: '10110',
} as const;
