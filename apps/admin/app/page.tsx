import { Surface } from "@builderbot/ui";
import {
  assignLeadAction,
  createKnowledgeDocumentAction,
  createProjectAction,
  createSupportTicketAction,
  createUnitAction,
  updateUnitAction
} from "./actions";
import { apiFetch } from "../lib/api";
import { SectionTitle } from "../components/section-title";
import { StatusChip } from "../components/status-chip";

interface DashboardResponse {
  projects: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
  leads: Array<Record<string, any>>;
  supportTickets: Array<Record<string, any>>;
  knowledgeDocuments: Array<Record<string, any>>;
  promptVersions: Array<Record<string, any>>;
}

function Metric({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        borderRadius: 20,
        padding: 18,
        background: "rgba(255,255,255,0.82)",
        border: "1px solid rgba(15, 23, 42, 0.08)"
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#475569" }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, marginTop: 8 }}>{value}</div>
    </div>
  );
}

export default async function HomePage() {
  const data = await apiFetch<DashboardResponse>("/admin/dashboard");

  return (
    <main style={{ maxWidth: 1440, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ marginBottom: 28 }}>
        <p
          style={{
            marginBottom: 8,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: "#0f766e",
            fontWeight: 700
          }}
        >
          Builder Sales Bot
        </p>
        <h1 style={{ margin: 0, fontSize: "clamp(2.2rem, 4vw, 4rem)", maxWidth: 840 }}>
          Панель управления продажным Telegram-ботом для застройщика
        </h1>
        <p style={{ maxWidth: 760, color: "#334155", fontSize: 18 }}>
          Здесь ты вручную управляешь проектами, квартирами, базой знаний и тем, как бот
          передает горячие лиды менеджерам.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 32
        }}
      >
        <Metric label="Проекты" value={data.projects.length} />
        <Metric label="Квартиры" value={data.units.length} />
        <Metric label="Лиды" value={data.leads.length} />
        <Metric label="Тикеты" value={data.supportTickets.length} />
        <Metric label="Документы" value={data.knowledgeDocuments.length} />
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 24,
          alignItems: "start"
        }}
      >
        <div style={{ display: "grid", gap: 24 }}>
          <Surface title="Каталог и продажи">
            <SectionTitle
              eyebrow="Catalog"
              title="Проекты и квартиры"
              body="Это основной источник правды для бота: отсюда он берет цены, доступность и аргументы при подборе вариантов."
            />

            <div style={{ display: "grid", gap: 24 }}>
              <form
                action={createProjectAction}
                style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}
              >
                <input name="name" placeholder="Название проекта" required />
                <input name="city" placeholder="Город" required />
                <input name="district" placeholder="Район" required />
                <input name="handoffPhone" placeholder="Телефон отдела продаж" />
                <textarea
                  name="description"
                  placeholder="Описание проекта"
                  required
                  style={{ gridColumn: "1 / -1" }}
                />
                <textarea
                  name="salesHeadline"
                  placeholder="Короткий sales headline"
                  required
                  style={{ gridColumn: "1 / -1" }}
                />
                <button type="submit" style={{ width: "fit-content" }}>
                  Добавить проект
                </button>
              </form>

              <form
                action={createUnitAction}
                style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}
              >
                <select name="projectId" required defaultValue="">
                  <option value="" disabled>
                    Проект
                  </option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <input name="code" placeholder="Код квартиры" required />
                <input name="rooms" type="number" placeholder="Комнат" required />
                <input name="floor" type="number" placeholder="Этаж" required />
                <input name="areaSqm" type="number" step="0.1" placeholder="Площадь, м2" required />
                <input name="priceRub" type="number" placeholder="Цена, RUB" required />
                <input name="finishing" placeholder="Отделка" required />
                <select name="status" defaultValue="available">
                  <option value="available">available</option>
                  <option value="reserved">reserved</option>
                  <option value="sold">sold</option>
                </select>
                <input
                  name="perks"
                  placeholder="Преимущества через запятую"
                  style={{ gridColumn: "1 / -1" }}
                />
                <button type="submit" style={{ width: "fit-content" }}>
                  Добавить квартиру
                </button>
              </form>

              <table>
                <thead>
                  <tr>
                    <th>Код</th>
                    <th>Проект</th>
                    <th>Параметры</th>
                    <th>Цена</th>
                    <th>Статус</th>
                    <th>Быстрое обновление</th>
                  </tr>
                </thead>
                <tbody>
                  {data.units.map((unit) => (
                    <tr key={unit.id}>
                      <td>{unit.code}</td>
                      <td>{unit.project?.name ?? "Без проекта"}</td>
                      <td>
                        {unit.rooms === 0 ? "Студия" : `${unit.rooms}-комн.`}
                        <br />
                        {unit.areaSqm} м2, этаж {unit.floor}
                      </td>
                      <td>{new Intl.NumberFormat("ru-RU").format(unit.priceRub)} RUB</td>
                      <td>
                        <StatusChip value={unit.status} />
                      </td>
                      <td>
                        <form action={updateUnitAction} style={{ display: "grid", gap: 8 }}>
                          <input type="hidden" name="unitId" value={unit.id} />
                          <select name="status" defaultValue={unit.status}>
                            <option value="available">available</option>
                            <option value="reserved">reserved</option>
                            <option value="sold">sold</option>
                          </select>
                          <input name="priceRub" defaultValue={unit.priceRub} />
                          <button type="submit">Сохранить</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface title="База знаний и playbook">
            <SectionTitle
              eyebrow="Knowledge"
              title="Контент, который учит бота продавать"
              body="Сюда загружаются FAQ, возражения, ипотечные условия, акции и любые тексты, которые бот должен использовать как источник правды."
            />

            <form
              action={createKnowledgeDocumentAction}
              style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}
            >
              <input name="title" placeholder="Название документа" required />
              <select name="kind" defaultValue="faq">
                <option value="faq">faq</option>
                <option value="sales_script">sales_script</option>
                <option value="objection_matrix">objection_matrix</option>
                <option value="promo">promo</option>
                <option value="mortgage">mortgage</option>
                <option value="policy">policy</option>
              </select>
              <input
                name="tags"
                placeholder="Теги через запятую"
                style={{ gridColumn: "1 / -1" }}
              />
              <input
                name="excerpt"
                placeholder="Короткий summary"
                required
                style={{ gridColumn: "1 / -1" }}
              />
              <textarea
                name="body"
                placeholder="Полный текст документа"
                required
                style={{ gridColumn: "1 / -1" }}
              />
              <button type="submit" style={{ width: "fit-content" }}>
                Загрузить документ
              </button>
            </form>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              {data.knowledgeDocuments.map((doc) => (
                <article
                  key={doc.id}
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      alignItems: "center"
                    }}
                  >
                    <strong>{doc.title}</strong>
                    <StatusChip value={doc.embeddingStatus} />
                  </div>
                  <p style={{ color: "#475569" }}>{doc.excerpt}</p>
                  <small>{doc.tags.join(", ")}</small>
                </article>
              ))}
            </div>
          </Surface>
        </div>

        <div style={{ display: "grid", gap: 24 }}>
          <Surface title="Лиды и handoff">
            <SectionTitle
              eyebrow="Leads"
              title="Горячие обращения"
              body="Когда бот видит готовность к покупке или рискованный кейс, он заводит лида и отправляет уведомление менеджеру."
            />
            <div style={{ display: "grid", gap: 14 }}>
              {data.leads.map((lead) => (
                <article
                  key={lead.id}
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{lead.fullName || "Новый лид"}</strong>
                    <StatusChip value={lead.status} />
                  </div>
                  <p style={{ marginBottom: 8 }}>{lead.summary}</p>
                  <div style={{ fontSize: 14, color: "#475569", marginBottom: 12 }}>
                    Intent: {lead.intent} | Score: {lead.leadScore}
                  </div>
                  <form action={assignLeadAction} style={{ display: "grid", gap: 8 }}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input
                      name="managerName"
                      defaultValue={lead.assignedManagerName ?? ""}
                      placeholder="Имя менеджера"
                      required
                    />
                    <input
                      name="managerChat"
                      defaultValue={lead.assignedManagerChat ?? ""}
                      placeholder="Telegram chat id менеджера"
                    />
                    <button type="submit">Назначить</button>
                  </form>
                </article>
              ))}
            </div>
          </Surface>

          <Surface title="Поддержка">
            <SectionTitle
              eyebrow="Support"
              title="Сервисные тикеты"
              body="Сюда попадают жалобы, сложные вопросы по документам и кейсы, которые бот не должен закрывать сам."
            />

            <form action={createSupportTicketAction} style={{ display: "grid", gap: 12 }}>
              <input name="conversationId" placeholder="Conversation ID" required />
              <input name="customerName" placeholder="Имя клиента" />
              <input name="phone" placeholder="Телефон" />
              <input name="topic" placeholder="Тема обращения" required />
              <textarea name="summary" placeholder="Краткое описание" required />
              <input name="assignedManager" placeholder="Ответственный менеджер" />
              <button type="submit" style={{ width: "fit-content" }}>
                Создать тикет
              </button>
            </form>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              {data.supportTickets.map((ticket) => (
                <article
                  key={ticket.id}
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{ticket.topic}</strong>
                    <StatusChip value={ticket.status} />
                  </div>
                  <p>{ticket.summary}</p>
                  <small style={{ color: "#475569" }}>
                    Клиент: {ticket.customerName || "не указан"}
                  </small>
                </article>
              ))}
            </div>
          </Surface>

          <Surface title="AI control">
            <SectionTitle
              eyebrow="Prompt"
              title="Активный sales brain"
              body="Эта секция показывает, какой системный промпт сейчас считается базовым источником поведения для AI-оркестратора."
            />
            <div style={{ display: "grid", gap: 12 }}>
              {data.promptVersions.map((prompt) => (
                <article
                  key={prompt.id}
                  style={{
                    padding: 16,
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(15, 23, 42, 0.08)"
                  }}
                >
                  <strong>{prompt.name}</strong>
                  <p style={{ color: "#475569" }}>{prompt.description}</p>
                  <code style={{ whiteSpace: "pre-wrap", display: "block", color: "#0f172a" }}>
                    {prompt.content}
                  </code>
                </article>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </main>
  );
}
