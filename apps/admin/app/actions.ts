"use server";

import { revalidatePath } from "next/cache";

const API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3000";

async function postJson(path: string, payload: unknown, method = "POST") {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `API request failed with ${response.status}`);
  }
}

export async function createProjectAction(formData: FormData) {
  await postJson("/admin/projects", {
    name: formData.get("name"),
    city: formData.get("city"),
    district: formData.get("district"),
    description: formData.get("description"),
    salesHeadline: formData.get("salesHeadline"),
    handoffPhone: formData.get("handoffPhone")
  });
  revalidatePath("/");
}

export async function createUnitAction(formData: FormData) {
  await postJson("/admin/units", {
    projectId: formData.get("projectId"),
    code: formData.get("code"),
    rooms: Number(formData.get("rooms")),
    floor: Number(formData.get("floor")),
    areaSqm: Number(formData.get("areaSqm")),
    priceRub: Number(formData.get("priceRub")),
    finishing: formData.get("finishing"),
    status: formData.get("status"),
    perks: String(formData.get("perks") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  });
  revalidatePath("/");
}

export async function updateUnitAction(formData: FormData) {
  const unitId = String(formData.get("unitId"));
  await postJson(
    `/admin/units/${unitId}`,
    {
      status: formData.get("status"),
      priceRub: Number(formData.get("priceRub"))
    },
    "PATCH"
  );
  revalidatePath("/");
}

export async function createKnowledgeDocumentAction(formData: FormData) {
  await postJson("/admin/knowledge-documents", {
    title: formData.get("title"),
    kind: formData.get("kind"),
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    excerpt: formData.get("excerpt"),
    body: formData.get("body")
  });
  revalidatePath("/");
}

export async function assignLeadAction(formData: FormData) {
  const leadId = String(formData.get("leadId"));
  await postJson(`/admin/leads/${leadId}/assign`, {
    managerName: formData.get("managerName"),
    managerChat: formData.get("managerChat")
  });
  revalidatePath("/");
}

export async function createSupportTicketAction(formData: FormData) {
  await postJson("/admin/support-tickets", {
    conversationId: formData.get("conversationId"),
    customerName: formData.get("customerName"),
    phone: formData.get("phone"),
    topic: formData.get("topic"),
    summary: formData.get("summary"),
    assignedManager: formData.get("assignedManager")
  });
  revalidatePath("/");
}
