import { Global, Module } from '@nestjs/common';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';

import { AssistantService } from './assistant.service';
import { FakeHelpEmbeddings, HELP_EMBEDDINGS } from './embeddings';
import { AssistantEvalService } from './eval/assistant-eval.service';
import { FakeAssistantModel } from './fake-model';
import { HelpSearchService } from './help-search.service';
import { LiveToolsFactory } from './live-tools';
import { ASSISTANT_MODEL } from './model.port';

/**
 * The assistant (U5.B5, D-304–D-306): sessions and turns, the help index, the evaluation harness and their jobs —
 * loaded by both processes. Only the fake model and fake embeddings exist until ADR-0012 is accepted (D-218).
 */
@Global()
@Module({
  imports: [SettingsAdminModule],
  providers: [
    AssistantService,
    HelpSearchService,
    AssistantEvalService,
    { provide: ASSISTANT_MODEL, useClass: FakeAssistantModel },
    { provide: HELP_EMBEDDINGS, useClass: FakeHelpEmbeddings },
  ],
  exports: [AssistantService, HelpSearchService, AssistantEvalService, ASSISTANT_MODEL],
})
export class AssistantModule {}

/** The live tools need API-only services (the advisor): the HTTP app only. */
@Global()
@Module({ providers: [LiveToolsFactory], exports: [LiveToolsFactory] })
export class AssistantApiModule {}
