import { type ValidationError } from 'class-validator';

import { flattenValidationErrors } from './validation';

describe('flattenValidationErrors', () => {
  it('builds dotted and indexed paths', () => {
    const errors: ValidationError[] = [
      { property: 'name', constraints: { isString: 'name must be a string' }, children: [] },
      {
        property: 'items',
        children: [
          {
            property: '0',
            children: [
              {
                property: 'quantity',
                constraints: { min: 'quantity must not be less than 1' },
                children: [],
              },
            ],
          },
        ],
      },
    ];
    expect(flattenValidationErrors(errors)).toEqual([
      { path: 'name', code: 'isString', message: 'name must be a string' },
      { path: 'items[0].quantity', code: 'min', message: 'quantity must not be less than 1' },
    ]);
  });
});
