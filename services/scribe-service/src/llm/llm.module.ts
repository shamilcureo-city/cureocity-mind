import { Global, Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type IModelRouter,
  type IPass1Backend,
  type IPass2Backend,
  type IPass3Backend,
  type IPass4Backend,
  type IPass5Backend,
  type IPass6Backend,
  type IPass7Backend,
  type IPass8Backend,
  type IPassCareReportBackend,
  type IPassDifferentialBackend,
  type IPassFindingsBackend,
  type IPassPlanDictationBackend,
  type IPassReasoningBackend,
  type IPassTherapyReasoningBackend,
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiPass3Backend,
  MockGeminiPass4Backend,
  MockGeminiPass5Backend,
  MockGeminiPass6Backend,
  MockGeminiPass7Backend,
  MockGeminiPass8Backend,
  MockGeminiCareReportBackend,
  MockGeminiDifferentialBackend,
  MockGeminiFindingsBackend,
  MockGeminiPlanDictationBackend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  ModelRouter,
  containerPolicyInput,
  resolveLlmBackend,
  VertexGeminiCareReportBackend,
  VertexGeminiDifferentialBackend,
  VertexGeminiFindingsBackend,
  VertexGeminiPlanDictationBackend,
  VertexGeminiReasoningBackend,
  VertexGeminiTherapyReasoningBackend,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProBriefBackend,
  VertexGeminiProCaseBriefingBackend,
  VertexGeminiProCaseConsultBackend,
  VertexGeminiProClinicalBackend,
  VertexGeminiProConceptualMapBackend,
  VertexGeminiProGlobalBackend,
  VertexGeminiProTherapyScriptBackend,
} from '@cureocity/llm';
import { PrismaService } from '../prisma/prisma.service';

export const MODEL_ROUTER = Symbol('MODEL_ROUTER');

/**
 * Builds the ModelRouter at boot. Switches to mock backends when
 * GCP_PROJECT_ID is unset (dev + tests). The onCallLog callback writes a
 * GeminiCallLog row per Gemini call — outside any per-request transaction
 * so call history survives even if the orchestrator later fails.
 */
const modelRouterProvider: Provider = {
  provide: MODEL_ROUTER,
  inject: [ConfigService, PrismaService],
  useFactory: (config: ConfigService, prisma: PrismaService): IModelRouter => {
    const logger = new Logger('ModelRouterFactory');
    const projectId = config.get<string>('GCP_PROJECT_ID');

    let pass1: IPass1Backend;
    let pass2: IPass2Backend;
    let pass3: IPass3Backend;
    let pass4: IPass4Backend;
    let pass5: IPass5Backend;
    let pass6: IPass6Backend;
    let pass7: IPass7Backend;
    let pass8: IPass8Backend;
    let passDifferential: IPassDifferentialBackend;
    let passCareReport: IPassCareReportBackend;
    let passFindings: IPassFindingsBackend;
    let passReasoning: IPassReasoningBackend;
    let passTherapyReasoning: IPassTherapyReasoningBackend;
    let passPlanDictation: IPassPlanDictationBackend;

    if (!projectId) {
      // TS-safety — defence in depth. This service is a scaffold with no
      // production deploy today, but keep the same invariant as apps/web +
      // the live gateway: never run mock on a deployed (NODE_ENV=production or
      // Cloud Run) environment. Under NODE_ENV=test / local dev this is a
      // no-op and mock proceeds. `requested: 'mock'` forces the mock-path
      // check regardless of any LLM_BACKEND value.
      resolveLlmBackend({ ...containerPolicyInput(process.env), requested: 'mock' });
      logger.warn(
        'GCP_PROJECT_ID is unset — using Mock backends for Pass 1-8. Do NOT ship to production like this.',
      );
      pass1 = new MockGeminiPass1Backend();
      pass2 = new MockGeminiPass2Backend();
      pass3 = new MockGeminiPass3Backend();
      pass4 = new MockGeminiPass4Backend();
      pass5 = new MockGeminiPass5Backend();
      pass6 = new MockGeminiPass6Backend();
      pass7 = new MockGeminiPass7Backend();
      pass8 = new MockGeminiPass8Backend();
      passDifferential = new MockGeminiDifferentialBackend();
      passCareReport = new MockGeminiCareReportBackend();
      passFindings = new MockGeminiFindingsBackend();
      passReasoning = new MockGeminiReasoningBackend();
      passTherapyReasoning = new MockGeminiTherapyReasoningBackend();
      passPlanDictation = new MockGeminiPlanDictationBackend();
    } else {
      const saKeyPath = config.get<string>('GCP_SA_KEY_PATH');
      pass1 = new VertexGeminiFlashIndiaBackend({
        projectId,
        location: config.get<string>('GEMINI_FLASH_REGION') ?? 'asia-south1',
        model: config.get<string>('GEMINI_FLASH_MODEL') ?? 'gemini-1.5-flash-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass2 = new VertexGeminiProGlobalBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model: config.get<string>('GEMINI_PRO_MODEL') ?? 'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass3 = new VertexGeminiProClinicalBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_CLINICAL_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass4 = new VertexGeminiProTherapyScriptBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_THERAPY_SCRIPT_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass5 = new VertexGeminiProBriefBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_BRIEF_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass6 = new VertexGeminiProCaseBriefingBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_BRIEF_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass7 = new VertexGeminiProConceptualMapBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_CONCEPTUAL_MAP_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      pass8 = new VertexGeminiProCaseConsultBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_CASE_CONSULT_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      passCareReport = new VertexGeminiCareReportBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_CARE_REPORT_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      passDifferential = new VertexGeminiDifferentialBackend({
        projectId,
        location: config.get<string>('GEMINI_PRO_REGION') ?? 'us-central1',
        model:
          config.get<string>('GEMINI_DIFFERENTIAL_MODEL') ??
          config.get<string>('GEMINI_PRO_MODEL') ??
          'gemini-1.5-pro-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      // Sprint DS1 — findings extractor. Flash in asia-south1 (DPDP).
      passFindings = new VertexGeminiFindingsBackend({
        projectId,
        location: config.get<string>('GEMINI_FLASH_REGION') ?? 'asia-south1',
        model:
          config.get<string>('GEMINI_FINDINGS_MODEL') ??
          config.get<string>('GEMINI_FLASH_MODEL') ??
          'gemini-1.5-flash-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      // Sprint DS2 — combined live reasoning. Flash in asia-south1 (DPDP).
      passReasoning = new VertexGeminiReasoningBackend({
        projectId,
        location: config.get<string>('GEMINI_FLASH_REGION') ?? 'asia-south1',
        model:
          config.get<string>('GEMINI_REASONING_MODEL') ??
          config.get<string>('GEMINI_FLASH_MODEL') ??
          'gemini-1.5-flash-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      // Sprint TS5 — live therapy reasoning. Flash in asia-south1 (DPDP).
      passTherapyReasoning = new VertexGeminiTherapyReasoningBackend({
        projectId,
        location: config.get<string>('GEMINI_FLASH_REGION') ?? 'asia-south1',
        model:
          config.get<string>('GEMINI_REASONING_MODEL') ??
          config.get<string>('GEMINI_FLASH_MODEL') ??
          'gemini-1.5-flash-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      // Sprint DS12 — plan dictation. Flash in asia-south1 (DPDP).
      passPlanDictation = new VertexGeminiPlanDictationBackend({
        projectId,
        location: config.get<string>('GEMINI_FLASH_REGION') ?? 'asia-south1',
        model:
          config.get<string>('GEMINI_PLAN_DICTATION_MODEL') ??
          config.get<string>('GEMINI_FLASH_MODEL') ??
          'gemini-1.5-flash-002',
        ...(saKeyPath !== undefined && { saKeyPath }),
      });
      logger.log(`Vertex backends initialised for project ${projectId}`);
    }

    return new ModelRouter({
      pass1,
      pass2,
      pass3,
      pass4,
      pass5,
      pass6,
      pass7,
      pass8,
      passDifferential,
      passCareReport,
      passFindings,
      passReasoning,
      passTherapyReasoning,
      passPlanDictation,
      onCallLog: async (log) => {
        await prisma.geminiCallLog.create({
          data: {
            sessionId: log.sessionId,
            pass: log.pass,
            model: log.model,
            region: log.region,
            promptVersion: log.promptVersion,
            inputTokens: log.inputTokens,
            outputTokens: log.outputTokens,
            costInr: log.costInr,
            latencyMs: log.latencyMs,
            status: log.status,
            errorMessage: log.errorMessage ?? null,
          },
        });
      },
    });
  },
};

@Global()
@Module({
  providers: [modelRouterProvider],
  exports: [modelRouterProvider],
})
export class LlmModule {}
