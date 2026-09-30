import { rfqDimensions, rfqFormFields } from './rfq-form';

describe('rfq form', () => {
  it('renders every schema property as a typed field with its labels, limits and options', () => {
    const schema = {
      type: 'object',
      required: ['material', 'handles'],
      properties: {
        material: {
          type: 'string',
          title: 'วัสดุ',
          'x-title-en': 'Material',
          'x-options': [{ value: 'kraft', labelTh: 'คราฟท์', labelEn: 'Kraft' }],
          enum: ['kraft'],
        },
        handles: { type: 'boolean', title: 'หูหิ้ว' },
        gsm: { type: 'integer', title: 'แกรม', minimum: 80, maximum: 400, 'x-unit': 'gsm' },
        finishes: { type: 'array', items: { enum: ['matt', 'gloss'] } },
        brief: { type: 'string', maxLength: 2000, description: 'รายละเอียด' },
        colour: { type: 'string' },
      },
    };
    const fields = rfqFormFields(schema);
    expect(fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ['material', 'select', true],
      ['handles', 'boolean', true],
      ['gsm', 'number', false],
      ['finishes', 'multiselect', false],
      ['brief', 'textarea', false],
      ['colour', 'text', false],
    ]);
    expect(fields[0]).toMatchObject({
      labelTh: 'วัสดุ',
      labelEn: 'Material',
      options: [{ value: 'kraft', labelTh: 'คราฟท์', labelEn: 'Kraft' }],
    });
    expect(fields[2]).toMatchObject({ min: 80, max: 400, unit: 'gsm', labelEn: 'แกรม' });
    expect(fields[3]!.options.map((o) => o.value)).toEqual(['matt', 'gloss']);
    expect(fields[4]).toMatchObject({ helpTh: 'รายละเอียด', helpEn: 'รายละเอียด' });
  });

  it('asks nothing extra without a schema and reads the dimension rule from the root', () => {
    expect(rfqFormFields(null)).toEqual([]);
    expect(rfqDimensions(null)).toEqual({ asked: true, required: false, height: true });
    expect(rfqDimensions({ 'x-dimensions': { required: true, height: false } })).toEqual({
      asked: true,
      required: true,
      height: false,
    });
  });
});
