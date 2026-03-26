import type { KnowledgeDocument, Project, Unit } from "@prisma/client";

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
  knowledgeDocuments: KnowledgeDocument[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  conversationText?: string;
}
