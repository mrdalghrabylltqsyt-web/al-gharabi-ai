import { CampaignOutput } from '../types/manager';

export class ApprovalGate {
  /**
   * صمام الأمان: يمنع أي نشر أو اعتماد تجاري دون قرار صريح من المالك.
   */
  public static approveCampaign(campaign: CampaignOutput, ownerApproved: boolean): CampaignOutput {
    if (!ownerApproved) {
      return {
        ...campaign,
        status: 'rejected',
        requiresApproval: true
      };
    }

    return {
      ...campaign,
      status: 'approved',
      requiresApproval: false
    };
  }

  public static isReadyForPublishing(campaign: CampaignOutput): boolean {
    return campaign.status === 'approved' && !campaign.requiresApproval;
  }
}
