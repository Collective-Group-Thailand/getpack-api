import { type LaunchpadActionItemDto, type ReorderCandidateDto } from './launchpad.dto';
import { nextStep } from './launchpad.service';

const item = (action: LaunchpadActionItemDto['action'], id: string): LaunchpadActionItemDto => ({
  action,
  subject: action === 'pay' ? 'order_group' : 'order',
  id,
  code: id,
  productType: null,
  dueAt: null,
  amount: null,
});
const reorder = (
  due: boolean,
  source: ReorderCandidateDto['source'] = 'suggestion',
): ReorderCandidateDto => ({
  source,
  suggestionId: source === 'suggestion' ? 's1' : null,
  orderId: 'o1',
  orderCode: 'PK-1',
  productType: { id: 't', code: 'folding_carton', nameTh: 'ก', nameEn: 'F' },
  quantity: 1000,
  suggestedOn: source === 'suggestion' ? '2026-10-01' : null,
  suggestedQuantity: source === 'suggestion' ? 1000 : null,
  due,
});

/** D-297: the first that applies — a waiting action, a due reorder, the latest design, else start. */
describe('launchpad next step (D-297)', () => {
  it('takes the first waiting action (the list is already in recommendation order)', () => {
    expect(
      nextStep([item('pay', 'g1'), item('approve_proof', 'o1')], [reorder(true)], [{ id: 'd1' }]),
    ).toEqual({
      kind: 'pay',
      target: 'order_group',
      targetId: 'g1',
    });
  });

  it('then a due reorder suggestion — never one not yet due, never a past order', () => {
    expect(nextStep([], [reorder(false), reorder(true)], [])).toEqual({
      kind: 'reorder',
      target: 'reorder_suggestion',
      targetId: 's1',
    });
    expect(nextStep([], [reorder(false), reorder(false, 'past_order')], [{ id: 'd1' }])).toEqual({
      kind: 'resume_design',
      target: 'design',
      targetId: 'd1',
    });
  });

  it('else starts a configuration', () => {
    expect(nextStep([], [], [])).toEqual({ kind: 'start_configuration', target: null, targetId: null });
  });
});
