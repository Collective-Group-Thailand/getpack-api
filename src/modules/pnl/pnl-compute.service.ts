import { bangkokDate } from '@common/time/bangkok';
import { Injectable } from '@nestjs/common';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type AutoResult, buildAutoCells, yearMonths } from './pnl-auto';
import { PnlDataService } from './pnl-data.service';
import { type CitRates, monthsBefore } from './pnl-engine';
import { PNL_LINES, type PnlForecastRules, type PnlLineCatalogue } from './pnl-lines';

export interface PnlSettingsInForce {
  catalogue: PnlLineCatalogue;
  catalogueVersionId: bigint;
  rules: PnlForecastRules;
  rulesVersionId: bigint;
  cit: CitRates;
  citVersionId: bigint;
  costOfCapitalPct: string;
  badDebtPct: string | null;
}

export interface PnlAutoValues extends AutoResult {
  asOf: Date;
  settings: PnlSettingsInForce;
  entityId: bigint;
}

/**
 * D-472: reads the settings in force and the data, and builds the system's value of every source line and month of
 * a plan year (`buildAutoCells`). Management figures only — nothing is written here.
 */
@Injectable()
export class PnlComputeService {
  constructor(
    private readonly settings: SettingsService,
    private readonly data: PnlDataService,
    private readonly entities: EntitiesService,
  ) {}

  async settingsInForce(at: Date): Promise<PnlSettingsInForce> {
    const [catalogue, rules, cit, capital] = await Promise.all([
      this.settings.at('pnl.line_catalogue', { at }),
      this.settings.at('pnl.forecast_rules', { at }),
      this.settings.at('tax.cit_rates', { at }),
      this.settings.value('finance.cost_of_capital_annual_pct', at),
    ]);
    let badDebtPct: string | null = null;
    try {
      badDebtPct =
        (await this.settings.value('finance.bad_debt_provision_pct', at)).byGrade['credit'] ?? null;
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    return {
      catalogue: catalogue.value,
      catalogueVersionId: catalogue.versionId,
      rules: rules.value,
      rulesVersionId: rules.versionId,
      cit: cit.value,
      citVersionId: cit.versionId,
      costOfCapitalPct: String(capital),
      badDebtPct,
    };
  }

  async autoValues(year: number, now = new Date()): Promise<PnlAutoValues> {
    const settings = await this.settingsInForce(now);
    const entityId = await this.entities.defaultEntityId();
    const currentMonth = bangkokDate(now).slice(0, 7);
    const months = yearMonths(year);
    const window = monthsBefore(currentMonth, settings.rules.trailingMonths);
    const from = [window[0]!, months[0]!].sort()[0]!;
    const to = [currentMonth, months[11]!].sort()[0]!;
    const sourceKeys = PNL_LINES.filter((l) => l.calc === 'source').map((l) => l.key);
    const forecastMonths = months.filter((m) => m > currentMonth);
    const [periodStatus, gl, customerRevenue, classRows, receivables, payables, pipeline, depreciation] =
      await Promise.all([
        this.data.periodStatus(entityId, months),
        from <= to
          ? this.data.glByLine(entityId, settings.catalogue, sourceKeys, from, to)
          : Promise.resolve(new Map()),
        this.data.revenueByCustomer(entityId, settings.catalogue, window),
        this.data.revenueCostByClass(entityId, settings.catalogue, window),
        from <= to
          ? this.data.balances(
              entityId,
              settings.catalogue.lines.memo_dso.glAccounts.map((g) => g.code),
              false,
              from,
              to,
            )
          : Promise.resolve(null),
        from <= to
          ? this.data.balances(
              entityId,
              settings.catalogue.lines.memo_dpo.glAccounts.map((g) => g.code),
              true,
              from,
              to,
            )
          : Promise.resolve(null),
        forecastMonths.length ? this.data.pipeline(now) : Promise.resolve([]),
        this.data.depreciation(entityId, forecastMonths),
      ]);
    const result = buildAutoCells({
      year,
      currentMonth,
      periodStatus,
      catalogue: settings.catalogue,
      rules: settings.rules,
      badDebtPct: settings.badDebtPct,
      gl,
      customerRevenue,
      classRows,
      receivables,
      payables,
      pipeline,
      depreciation: depreciation.byMonth,
      assetCount: depreciation.assetCount,
    });
    return { ...result, asOf: now, settings, entityId };
  }
}
