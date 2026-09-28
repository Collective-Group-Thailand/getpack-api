// Load-test targets (B6.3). **Proposed** values — no decision gives traffic or latency targets yet; they are set
// from the launch plan in perf/README.md and confirmed by the business before the go / no-go (LAUNCH-CHECKLIST).
export const TARGETS = {
  /** Share of failed requests allowed in every scenario. */
  errorRate: 0.01,
  browse: {
    /** Arrival rate at the browse/quote peak (iterations per second ≈ visitors starting a journey). */
    peakRps: Number(__ENV.PEAK_RPS || 30),
    catalogP95Ms: 300,
    calculateP95Ms: 800,
    saveP95Ms: 1000,
    eventsP95Ms: 250,
  },
  checkout: {
    /** Concurrent customers going from quotation to paid order. */
    vus: Number(__ENV.CHECKOUT_VUS || 20),
    cartP95Ms: 600,
    checkoutP95Ms: 1500,
    paymentP95Ms: 1200,
  },
  partner: {
    /** Concurrent factory users posting milestone and shipment updates. */
    vus: Number(__ENV.PARTNER_VUS || 10),
    listP95Ms: 500,
    updateP95Ms: 800,
  },
};
