export type ProjectStatus = "active" | "paused" | "sold_out";
export type UnitStatus = "available" | "reserved" | "sold";
export type LeadStatus = "new" | "qualified" | "assigned" | "won" | "lost";
export type SupportStatus = "new" | "in_progress" | "resolved";
export type ConversationChannel = "telegram";
export interface ProjectSummary {
    id: string;
    name: string;
    city: string;
    district: string;
    status: ProjectStatus;
    handoffPhone?: string | null;
    salesHeadline: string;
}
export interface UnitSummary {
    id: string;
    projectId: string;
    code: string;
    rooms: number;
    floor: number;
    areaSqm: number;
    priceRub: number;
    status: UnitStatus;
    finishing: string;
    availableFrom?: string | null;
    perks: string[];
}
export interface LeadSummary {
    id: string;
    fullName?: string | null;
    phone?: string | null;
    source: ConversationChannel;
    status: LeadStatus;
    leadScore: number;
    managerName?: string | null;
    intent: string;
    summary: string;
}
export interface SupportTicketSummary {
    id: string;
    customerName?: string | null;
    status: SupportStatus;
    topic: string;
    summary: string;
}
