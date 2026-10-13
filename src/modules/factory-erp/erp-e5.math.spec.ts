import { nextActions } from '@common/next-actions/next-actions';

import { dec } from './erp.math';
import { renderCoaHtml } from './erp-documents.render';
import {
  checkResult,
  jobCost,
  measurementOutcome,
  oeeOf,
  operationSegments,
  overlapMinutes,
  pct1,
  shiftMinutes,
} from './erp-e5.math';
import { CHECK_ACTIONS, NCR_ACTIONS, specText } from './erp-quality.service';

const T0 = Date.parse('2026-10-12T01:00:00Z'); // 08:00 Bangkok
const min = (n: number) => T0 + n * 60_000;

describe('Factory ERP E5 arithmetic and documents', () => {
  it('judges a measurement against open or closed limits (D-372)', () => {
    expect(measurementOutcome(dec('3.05'), dec('2.9'), dec('3.3'))).toBe('pass');
    expect(measurementOutcome(dec('2.8'), dec('2.9'), dec('3.3'))).toBe('fail');
    expect(measurementOutcome(dec('9'), null, dec('8'))).toBe('fail');
    expect(measurementOutcome(dec('9'), dec('8'), null)).toBe('pass');
    expect(measurementOutcome(null, dec('1'), dec('2'))).toBeNull();
  });

  it('adds checkpoints up to a result: any fail fails, unanswered waits, notes never decide (D-372)', () => {
    expect(checkResult([{ type: 'pass_fail', outcome: 'pass' }, { type: 'note', outcome: null }])).toBe('pass');
    expect(checkResult([{ type: 'pass_fail', outcome: 'pass' }, { type: 'measurement', outcome: null }])).toBe('pending');
    expect(checkResult([{ type: 'pass_fail', outcome: null }, { type: 'measurement', outcome: 'fail' }])).toBe('fail');
    expect(checkResult([{ type: 'pass_fail', outcome: 'na' }])).toBe('pass');
    expect(checkResult([{ type: 'pass_fail', outcome: 'pass' }], dec(3))).toBe('conditional');
  });

  it('costs a job: materials, machine and labour by run minutes, overhead on top (D-376)', () => {
    const c = jobCost({
      material: dec('31250'),
      runs: [
        { minutes: 300, machineRate: dec('850') },
        { minutes: 60, machineRate: null },
      ],
      labourRatePerHour: dec('120'),
      overheadPct: dec('15'),
    });
    expect(c.machine.toFixed(2)).toBe('4250.00');
    expect(c.labour.toFixed(2)).toBe('720.00');
    expect(c.overhead.toFixed(2)).toBe('5433.00');
    expect(c.total.toFixed(2)).toBe('41653.00');
  });

  it('splits an operation into running and paused spans (D-353, D-377)', () => {
    const seg = operationSegments(
      [
        { kind: 'start', at: min(0) },
        { kind: 'pause', at: min(60), reason: 'setup' },
        { kind: 'resume', at: min(90) },
        { kind: 'finish', at: min(150) },
      ],
      min(500),
    );
    expect(seg.run).toEqual([
      [min(0), min(60)],
      [min(90), min(150)],
    ]);
    expect(seg.pauses).toEqual([{ from: min(60), to: min(90), reason: 'setup' }]);
    const open = operationSegments([{ kind: 'start', at: min(0) }], min(45));
    expect(open.run).toEqual([[min(0), min(45)]]);
    expect(overlapMinutes(min(0), min(120), min(60), min(600))).toBe(60);
  });

  it('computes OEE with performance capped at 100% (D-377)', () => {
    const o = oeeOf({ plannedMinutes: 480, runMinutes: 400, idealMinutes: 360, good: dec(990), scrap: dec(10) });
    expect(pct1(o.availability)).toBe('83.3');
    expect(pct1(o.performance)).toBe('90.0');
    expect(pct1(o.quality)).toBe('99.0');
    expect(o.oee).toBeCloseTo(0.7425, 6);
    expect(oeeOf({ plannedMinutes: 480, runMinutes: 100, idealMinutes: 300, good: dec(1), scrap: dec(0) }).performance).toBe(1);
    expect(oeeOf({ plannedMinutes: 0, runMinutes: 0, idealMinutes: 0, good: dec(0), scrap: dec(0) }).oee).toBe(0);
  });

  it('measures shifts, past midnight too (D-380)', () => {
    expect(shiftMinutes('08:00', '17:00')).toBe(540);
    expect(shiftMinutes('20:00', '05:00')).toBe(540);
  });

  it('offers quality actions by state and permission (D-372, D-374)', () => {
    const qc = new Set(['factory_quality.read', 'factory_quality.record']);
    expect(nextActions({ result: 'pending', kind: 'final', locked: false }, CHECK_ACTIONS, qc).map((a) => a.key)).toEqual(['erp_qc.record']);
    expect(nextActions({ result: 'pass', kind: 'final', locked: false }, CHECK_ACTIONS, qc).map((a) => a.key)).toEqual(['erp_qc.coa']);
    const manage = new Set([...qc, 'factory_quality.manage']);
    const open = nextActions({ status: 'open', disposition: null, ready: false }, NCR_ACTIONS, manage);
    expect(open.map((a) => a.key)).toEqual(['erp_ncr.edit', 'erp_ncr.dispose', 'erp_ncr.verify', 'erp_ncr.cancel']);
    expect(open.find((a) => a.key === 'erp_ncr.verify')?.disabledReason).toBeTruthy();
    expect(nextActions({ status: 'in_progress', disposition: 'scrap', ready: true }, NCR_ACTIONS, manage).map((a) => a.key)).toEqual([
      'erp_ncr.edit',
      'erp_ncr.verify',
    ]);
  });

  it('prints a certificate of analysis with the limits (D-375)', () => {
    expect(specText({ type: 'measurement', unit: 'mm', minValue: dec('2.9000'), maxValue: dec('3.3000'), targetValue: null })).toBe('2.9 – 3.3 mm');
    expect(specText({ type: 'measurement', unit: null, minValue: dec('5'), maxValue: null, targetValue: dec('6') })).toBe('≥ 5 (เป้า 6)');
    const html = renderCoaHtml({
      seller: { name: 'บจก. ทดสอบ', address: '1 ถนนทดสอบ', taxId: null, branchCode: null, phone: null },
      logo: null,
      footer: null,
      qcNo: 'QC-2610-0004',
      product: 'กล่อง <RSC>',
      sku: 'BOX-1',
      lotNo: 'LOT-1',
      quantity: '4,950 pcs',
      orderNo: 'MO-2610-0007',
      inspectedOn: '2026-10-13',
      inspector: 'QC',
      result: 'conditional',
      points: [{ name: 'ความหนา', spec: '2.9 – 3.3 mm', reading: '3.05 mm', outcome: 'pass' }],
      remarks: null,
    });
    expect(html).toContain('Certificate of Analysis');
    expect(html).toContain('ผ่านแบบมีเงื่อนไข');
    expect(html).toContain('กล่อง &lt;RSC&gt;');
  });
});
