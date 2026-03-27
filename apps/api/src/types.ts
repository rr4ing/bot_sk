import type { KnowledgeDocument, Project, Unit } from "@prisma/client";

export type PurchasePurpose = "self" | "family" | "investment" | "parents" | null;
export type PurchaseTimeline = "urgent" | "soon" | "later" | null;

export interface ConversationState {
  purpose: PurchasePurpose;
  budgetRub: number | null;
  rooms: number | null;
  timeline: PurchaseTimeline;
  hasPhone: boolean;
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  lastRecommendedUnitId?: string | null;
  lastRecommendedUnitCode?: string | null;
  lastUserMessage?: string | null;
  updatedAt?: string | null;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: {
      id: number;
      type: string;
    };
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    contact?: {
      phone_number: string;
      first_name: string;
      last_name?: string;
    };
  };
}

export interface DecisionContext {
  activeProject: Project | null;
  candidateUnits: Unit[];
  projectEntryUnit?: Unit | null;
  knowledgeDocuments: KnowledgeDocument[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  conversationText?: string;
  conversationState?: ConversationState | null;
}
