/**
 * `pnpm agents:retire-bounty [--apply]` — P-03 / D-464 (agent portal pack, Phase 0). Ends pending factory links with
 * reason `programme_change_P03` and adds, to every plan whose version in force still carries a factory bounty, a new
 * approved version with the bounty at 0 (other terms copied). Dry run by default: prints counts and codes only, writes
 * nothing. `--apply` runs it in one transaction, audited. Idempotent: a second run finds nothing to do.
 */
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';

import { AppModule } from '../src/app.module';
import { systemActor } from '../src/common/context/actor';
import { AgentBountyRetirementService } from '../src/modules/agents/agent-bounty-retirement.service';

config({ quiet: true });

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const service = app.get(AgentBountyRetirementService);
    const plan = await service.plan();
    console.log(
      `${plan.pendingFactoryLinks.length} pending factory link(s) to end, ` +
        `${plan.plansWithBounty.length} plan(s) with a bounty in force`,
    );
    for (const l of plan.pendingFactoryLinks) console.log(`  link ${l.id}  agent ${l.agentCode}  ${l.linkedAt}`);
    for (const p of plan.plansWithBounty) console.log(`  plan ${p.code} v${p.versionNo}  bounty ${p.bounty}`);
    if (!apply) {
      console.log('dry run: nothing written (add --apply)');
      return;
    }
    const result = await service.apply(systemActor('maintenance:agents-retire-bounty'));
    console.log(`done: ${result.linksEnded} link(s) ended, ${result.versionsAdded} plan version(s) added`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
