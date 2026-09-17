import { MarketingCampaignInput, GeneralManagerDecision, CampaignOutput } from '../types/manager';
import { AL_GHARABI_RULES, validateStoreContent } from '../config/storeRules';

export class AlGharabiGeneralManager {
  public evaluateAndPlan(input: MarketingCampaignInput): GeneralManagerDecision {
    if (input.customInstructions && !validateStoreContent(input.customInstructions)) {
      throw new Error("محتوى الطلب يخالف سياسات وقواعد معرض الغرابي للتقسيط.");
    }

    const campaigns: CampaignOutput[] = input.platforms.map((platform, index) => ({
      id: `campaign-${Date.now()}-${index}`,
      platform: platform,
      content: `عروض ${AL_GHARABI_RULES.storeName}: ${input.goal} بأفضل أسعار التقسيط في العراق.`,
      mediaIdeas: ["فيديو قصير يوضح المنتج", "صورة احترافية مع الأسعار"],
      suggestedPostingTime: "07:00 PM",
      requiresApproval: true,
      status: "pending_approval"
    }));

    return {
      analysis: `تحليل السوق لـ ${AL_GHARABI_RULES.storeName}: الطلب مستقر ومناسب للحملات الرقمية.`,
      strategy: `استراتيجية موجهة لزيادة مبيعات ${AL_GHARABI_RULES.currency} عبر منصات التواصل الاجتماعي.`,
      campaigns
    };
  }
}

