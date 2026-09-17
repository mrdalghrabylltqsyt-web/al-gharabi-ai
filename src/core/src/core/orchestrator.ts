import { AlGharabiGeneralManager } from './generalManager';
import { ApprovalGate } from './approvalGate';
import { MarketingCampaignInput, GeneralManagerDecision, CampaignOutput } from '../types/manager';

export class GharabiOrchestrator {
  private manager: AlGharabiGeneralManager;

  constructor() {
    this.manager = new AlGharabiGeneralManager();
  }

  public executeCampaignPipeline(input: MarketingCampaignInput): GeneralManagerDecision {
    return this.manager.evaluateAndPlan(input);
  }

  public applyOwnerApproval(campaign: CampaignOutput, isApproved: boolean): CampaignOutput {
    return ApprovalGate.approveCampaign(campaign, isApproved);
  }
}
