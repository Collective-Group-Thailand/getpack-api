import { fixedTestOtp } from './otp.service';

describe('fixedTestOtp (UAT rehearsal sign-in)', () => {
  const fake = { useFakes: true, isProduction: false };

  it('gives the test numbers 080000xxxx an all-zero code on a fake, non-production stack', () => {
    expect(fixedTestOtp('+66800000101', 6, fake)).toBe('000000');
    expect(fixedTestOtp('+66800009999', 4, fake)).toBe('0000');
  });

  it('never applies to a real number, to real integrations or to production', () => {
    expect(fixedTestOtp('+66812345678', 6, fake)).toBeNull();
    expect(fixedTestOtp('+668000001010', 6, fake)).toBeNull();
    expect(fixedTestOtp('+66800000101', 6, { useFakes: false, isProduction: false })).toBeNull();
    expect(fixedTestOtp('+66800000101', 6, { useFakes: true, isProduction: true })).toBeNull();
  });
});
