import { MarketingCampaignInput, GeneralManagerDecision, CampaignOutput } from '../types/manager';

export class AlGharabiGeneralManager {
  /**
   * تقييم الحملة التسويقية لـ "معرض الغرابي" وتحديد الميزانية والقنوات الملائمة.
   */
  public evaluateAndPlan(input: MarketingCampaignInput): GeneralManagerDecision {
    const minBudget = 50;
    const isBudgetValid = input.budget >= minBudget;

    if (!isBudgetValid) {
      return {
        success: false,
        message: `الميزانية المدخلة (${input.budget}$) أقل من الحد الأدنى المقبول لمعرض الغرابي وهو ${minBudget}$.`,
      };
    }

    const recommendedChannels = this.selectChannels(input.targetAudience);
    
    const campaign: CampaignOutput = {
      id: `gharabi-${Date.now()}`,
      title: input.campaignTitle,
      budget: input.budget,
      channels: recommendedChannels,
      status: 'pending',
      requiresApproval: true
    };

    return {
      success: true,
      message: 'تمت دراسة الحملة وتجهيز المسودة بنجاح تحت إشراف وكيل الغرابي الذكي.',
      campaign
    };
  }

  private selectChannels(audience: string): string[] {
    const channels = ['فيسبوك', 'إنستجرام'];
    if (audience.includes('شباب') || audience.includes('فيديو')) {
      channels.push('تيك توك');
    }
    return channels;
  }
}
