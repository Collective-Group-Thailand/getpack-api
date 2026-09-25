import { type Tx } from '@database/prisma.service';
import { type Prisma, type SuggestionMethod } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';
import Decimal from 'decimal.js';

import { IndexSeriesService, monthOf, periodOf } from '../index-series/index-series.service';
import {
  type PriceColumn,
  type PriceComponentDescriptor,
  PriceComponentRegistry,
  type PriceValues,
} from './price-component.registry';
import { PriceListBuilder } from './price-list-builder';
import { deviationPct, spread } from './stats';

type LineRow = Prisma.PriceProposalLineGetPayload<object>;

/** Suggestion for one proposal line (stored in `price_line_suggestions`, staff-only). */
export interface LineSuggestion {
  method: SuggestionMethod;
  suggestedValues: PriceValues | null;
  /** Series, points, ratios, peer count and percentiles — never another factory's identity (D-044). */
  basis: Record<string, unknown>;
  deviationPct: Decimal | null;
  flags: string[];
}

/** What the engine needs to know about the proposal being reviewed. */
export interface SuggestionContext {
  factoryId: bigint;
  productTypeId: bigint;
  /** Effective date of the version the current values come from (the "last approval"). */
  baseEffectiveFrom: Date | null;
  now: Date;
}

interface Ratio {
  series: string;
  then: { period: string; value: string };
  now: { period: string; value: string };
  ratio: Decimal;
}

const decimalColumns = (d: PriceComponentDescriptor) => d.values.filter((c) => c.type === 'decimal');
const scaled = (c: PriceColumn, v: Decimal) =>
  v.toDecimalPlaces(c.scale ?? 6, Decimal.ROUND_HALF_UP).toFixed(c.scale ?? 6);

/**
 * Staff-only price suggestions per line and D-040 group (decision note D-040):
 *
 * 1. materials — approved price × (index now ÷ index at last approval) of the family's series;
 * 2. process rates — the lower of own history × cost-driver index and the peer P75, peers only when at
 *    least `partners.peer_benchmark_min_factories` other active factories price the same line (D-044);
 * 3. waste — actual scrap from production reports (B4): none yet, `no_actuals`;
 * 4. commercial terms — impact only;
 * 5. shipping — from the rate cards (B2.4): none yet.
 *
 * The deviation is always computed when there is a suggestion; `above_band` is raised only once a
 * superadmin has set `partners.suggestion_deviation_band_pct` (D-172).
 */
@Injectable()
export class SuggestionEngine {
  constructor(
    private readonly registry: PriceComponentRegistry,
    private readonly builder: PriceListBuilder,
    private readonly indices: IndexSeriesService,
    private readonly settings: SettingsService,
  ) {}

  async suggestAll(
    tx: Tx,
    context: SuggestionContext,
    lines: LineRow[],
  ): Promise<Map<bigint, LineSuggestion>> {
    const band = await this.band(context.now);
    const peers = await this.peerVersions(tx, context);
    const minPeers = await this.settings.value('partners.peer_benchmark_min_factories', context.now);
    const result = new Map<bigint, LineSuggestion>();
    for (const line of lines) {
      const d = this.registry.get(line.component);
      if (!d) continue;
      const suggestion = await this.suggest(tx, d, line, context, { peers, minPeers });
      const flags = [...suggestion.flags];
      if (band !== null && suggestion.deviationPct !== null && suggestion.deviationPct.abs().gt(band)) {
        flags.push('above_band');
      }
      result.set(line.id, {
        ...suggestion,
        flags,
        basis: { group: d.group, ...(band !== null && { bandPct: band.toString() }), ...suggestion.basis },
      });
    }
    return result;
  }

  private async suggest(
    tx: Tx,
    d: PriceComponentDescriptor,
    line: LineRow,
    context: SuggestionContext,
    peerInfo: { peers: bigint[]; minPeers: number },
  ): Promise<LineSuggestion> {
    const none = (flags: string[], basis: Record<string, unknown> = {}): LineSuggestion => ({
      method: 'none',
      suggestedValues: null,
      basis,
      deviationPct: null,
      flags,
    });
    if (line.action === 'remove') return none(['removal']);
    switch (d.group) {
      case 'waste':
        return none(['no_actuals']);
      case 'commercial_terms':
        return none(['impact_only']);
      case 'shipping':
        return none(['rate_cards_not_available']);
      case 'rules':
        return none(['not_suggested']);
      default:
        break;
    }
    const current = line.currentValues as PriceValues | null;
    const proposed = line.proposedValues as PriceValues;

    if (d.group === 'materials') {
      if (!current) return none(['no_approved_price']);
      const family = d.materialFamilyOf ? await d.materialFamilyOf(proposed, tx) : null;
      if (family === null) return none(['material_family_unknown']);
      const series = await tx.indexSeries.findFirst({
        where: { kind: 'material', materialFamilyId: family },
        orderBy: { code: 'asc' },
      });
      if (!series) return none(['index_not_configured']);
      const ratio = await this.ratio(tx, series, context);
      if (!ratio) return none(['index_point_missing'], { series: series.code });
      const suggested = this.apply(d, current, (c) => new Decimal(String(current[c.key])).times(ratio.ratio));
      return this.finish(d, 'material_index', suggested, proposed, { index: this.ratioBasis(ratio) }, []);
    }

    // Group 2: own history × cost driver, and the peer spread.
    const flags: string[] = [];
    const basis: Record<string, unknown> = {};
    let own: PriceValues | null = null;
    if (!current) {
      flags.push('no_approved_price');
    } else if (!d.costDriverSeries) {
      flags.push('driver_not_configured');
    } else {
      const series = await tx.indexSeries.findUnique({ where: { code: d.costDriverSeries } });
      const ratio = series ? await this.ratio(tx, series, context) : null;
      if (!series) flags.push('driver_not_configured');
      else if (!ratio) flags.push('index_point_missing');
      else {
        own = this.apply(d, current, (c) => new Decimal(String(current[c.key])).times(ratio.ratio));
        basis['driver'] = this.ratioBasis(ratio);
      }
    }
    let p75: PriceValues | null = null;
    const samples = await this.peerSamples(tx, d, line.lineKey, peerInfo.peers);
    if (samples.length < peerInfo.minPeers) {
      flags.push('peers_below_minimum');
    } else {
      const columns: Record<string, { p25: string; median: string; p75: string }> = {};
      const base: PriceValues = { ...proposed };
      for (const c of decimalColumns(d)) {
        const values = samples
          .map((s) => s[c.key])
          .filter((v) => v !== null && v !== undefined)
          .map((v) => new Decimal(String(v)));
        if (values.length < peerInfo.minPeers) continue;
        const s = spread(values);
        columns[c.key] = { p25: scaled(c, s.p25), median: scaled(c, s.median), p75: scaled(c, s.p75) };
        base[c.key] = scaled(c, s.p75);
      }
      if (Object.keys(columns).length > 0) {
        p75 = base;
        basis['peers'] = { count: samples.length, columns };
      } else {
        flags.push('peers_below_minimum');
      }
    }
    if (!own && !p75) return none(flags, basis);
    // Suggest the lower of the two per value column (D-040 note, group 2).
    const primary = decimalColumns(d)[0];
    const pick = (c: PriceColumn): Decimal => {
      const a = own ? new Decimal(String(own[c.key])) : null;
      const b = p75?.[c.key] !== undefined && p75[c.key] !== null ? new Decimal(String(p75[c.key])) : null;
      return a && b ? Decimal.min(a, b) : (a ?? b)!;
    };
    const suggested = this.apply(d, own ?? p75!, pick);
    const method: SuggestionMethod =
      own && p75 && primary
        ? new Decimal(String(own[primary.key])).lte(new Decimal(String(p75[primary.key])))
          ? 'own_history_driver'
          : 'peer_benchmark'
        : own
          ? 'own_history_driver'
          : 'peer_benchmark';
    return this.finish(d, method, suggested, proposed, basis, flags);
  }

  private finish(
    d: PriceComponentDescriptor,
    method: SuggestionMethod,
    suggested: PriceValues,
    proposed: PriceValues,
    basis: Record<string, unknown>,
    flags: string[],
  ): LineSuggestion {
    const primary = decimalColumns(d)[0];
    const deviation =
      primary && proposed[primary.key] !== null && suggested[primary.key] !== null
        ? deviationPct(
            new Decimal(String(proposed[primary.key])),
            new Decimal(String(suggested[primary.key])),
          )
        : null;
    return {
      method,
      suggestedValues: suggested,
      basis: { ...basis, ...(primary && { primaryColumn: primary.key }) },
      deviationPct: deviation?.toDecimalPlaces(4, Decimal.ROUND_HALF_UP) ?? null,
      flags,
    };
  }

  /** Copies `from` and replaces each decimal value column by `value(column)` at the column scale. */
  private apply(
    d: PriceComponentDescriptor,
    from: PriceValues,
    value: (c: PriceColumn) => Decimal,
  ): PriceValues {
    const result: PriceValues = { ...from };
    for (const c of decimalColumns(d)) {
      if (from[c.key] === null || from[c.key] === undefined) continue;
      result[c.key] = scaled(c, value(c));
    }
    return result;
  }

  /** Index now ÷ index at the month of the last approval (latest values at or before each month). */
  private async ratio(
    tx: Tx,
    series: { id: bigint; code: string },
    context: SuggestionContext,
  ): Promise<Ratio | null> {
    if (!context.baseEffectiveFrom) return null;
    const [then, now] = await Promise.all([
      this.indices.pointAt(series.id, monthOf(context.baseEffectiveFrom), tx),
      this.indices.pointAt(series.id, monthOf(context.now), tx),
    ]);
    if (!then || !now) return null;
    return {
      series: series.code,
      then: { period: periodOf(then.period), value: then.value.toFixed(6) },
      now: { period: periodOf(now.period), value: now.value.toFixed(6) },
      ratio: new Decimal(now.value.toString()).dividedBy(then.value.toString()),
    };
  }

  private ratioBasis(r: Ratio) {
    return { series: r.series, then: r.then, now: r.now, ratio: r.ratio.toDecimalPlaces(6).toString() };
  }

  /**
   * Versions in force of the other active factories that price this type with tier A or B — the peer
   * set. Identities stay inside the engine; only counts and percentiles leave it.
   */
  private async peerVersions(tx: Tx, context: SuggestionContext): Promise<bigint[]> {
    const factories = await tx.factory.findMany({
      where: {
        id: { not: context.factoryId },
        status: 'active',
        participations: {
          some: {
            productTypeId: context.productTypeId,
            versions: { some: { status: 'approved', effectiveFrom: { lte: context.now } } },
          },
        },
      },
      select: {
        id: true,
        participations: {
          where: { productTypeId: context.productTypeId },
          select: {
            versions: {
              where: { status: 'approved', effectiveFrom: { lte: context.now } },
              orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
              take: 1,
              select: { tier: true },
            },
          },
        },
      },
    });
    const versions: bigint[] = [];
    for (const f of factories) {
      const tier = f.participations[0]?.versions[0]?.tier;
      if (tier !== 'A' && tier !== 'B') continue;
      const version = await tx.priceListVersion.findFirst({
        where: {
          priceList: { factoryId: f.id, productTypeId: context.productTypeId },
          status: 'approved',
          effectiveFrom: { lte: context.now },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        select: { id: true },
      });
      if (version) versions.push(version.id);
    }
    return versions;
  }

  private async peerSamples(tx: Tx, d: PriceComponentDescriptor, lineKey: string, versions: bigint[]) {
    const samples: PriceValues[] = [];
    for (const versionId of versions) {
      const row = await this.builder.row(tx, versionId, d.component, lineKey);
      if (row) samples.push(row);
    }
    return samples;
  }

  private async band(at: Date): Promise<Decimal | null> {
    try {
      return new Decimal(await this.settings.value('partners.suggestion_deviation_band_pct', at));
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }
}
