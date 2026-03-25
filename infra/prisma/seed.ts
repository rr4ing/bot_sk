import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.upsert({
    where: { id: "seed-project" },
    update: {
      name: "Северный берег",
      city: "Москва",
      district: "Северо-Запад",
      description: "Семейный жилой квартал у парка и метро.",
      salesHeadline: "Квартиры для жизни и инвестиций рядом с метро и парком.",
      handoffPhone: "+7 900 000-00-00",
      status: "active"
    },
    create: {
      id: "seed-project",
      name: "Северный берег",
      city: "Москва",
      district: "Северо-Запад",
      description: "Семейный жилой квартал у парка и метро.",
      salesHeadline: "Квартиры для жизни и инвестиций рядом с метро и парком.",
      handoffPhone: "+7 900 000-00-00",
      status: "active"
    }
  });

  await prisma.unit.createMany({
    data: [
      {
        code: "SB-1-047",
        projectId: project.id,
        rooms: 1,
        floor: 4,
        areaSqm: 39.5,
        priceRub: 11800000,
        finishing: "white box",
        status: "available",
        perks: ["5 минут до метро", "вид на парк"]
      },
      {
        code: "SB-2-113",
        projectId: project.id,
        rooms: 2,
        floor: 11,
        areaSqm: 57.8,
        priceRub: 16700000,
        finishing: "clean finish",
        status: "available",
        perks: ["евроформат", "мастер-спальня"]
      },
      {
        code: "SB-3-186",
        projectId: project.id,
        rooms: 3,
        floor: 18,
        areaSqm: 83.2,
        priceRub: 23900000,
        finishing: "designer",
        status: "reserved",
        perks: ["угловое остекление", "вид на реку"]
      }
    ],
    skipDuplicates: true
  });

  const playbook = readFileSync(
    resolve(process.cwd(), "content/playbook/sales-playbook.md"),
    "utf8"
  );

  await prisma.knowledgeDocument.upsert({
    where: { id: "seed-playbook" },
    update: {
      title: "Базовый sales playbook",
      kind: "sales_script",
      tags: ["playbook", "sales", "qualification"],
      body: playbook,
      excerpt: "Стартовый sales playbook с вопросами, возражениями и правилами эскалации.",
      embeddingStatus: "pending"
    },
    create: {
      id: "seed-playbook",
      title: "Базовый sales playbook",
      kind: "sales_script",
      tags: ["playbook", "sales", "qualification"],
      body: playbook,
      excerpt: "Стартовый sales playbook с вопросами, возражениями и правилами эскалации.",
      embeddingStatus: "pending"
    }
  });

  await prisma.promptVersion.upsert({
    where: { id: "seed-prompt" },
    update: {
      projectId: project.id,
      name: "default-sales-brain",
      description: "Главный системный промпт для продаж и поддержки.",
      content: "Веди диалог в роли внимательного консультанта застройщика. Не выдумывай цены и наличие вне переданного контекста. Всегда завершай ответ следующим шагом.",
      isActive: true
    },
    create: {
      id: "seed-prompt",
      projectId: project.id,
      name: "default-sales-brain",
      description: "Главный системный промпт для продаж и поддержки.",
      content: "Веди диалог в роли внимательного консультанта застройщика. Не выдумывай цены и наличие вне переданного контекста. Всегда завершай ответ следующим шагом.",
      isActive: true
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
