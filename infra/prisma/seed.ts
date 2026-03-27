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
      status: "paused"
    },
    create: {
      id: "seed-project",
      name: "Северный берег",
      city: "Москва",
      district: "Северо-Запад",
      description: "Семейный жилой квартал у парка и метро.",
      salesHeadline: "Квартиры для жизни и инвестиций рядом с метро и парком.",
      handoffPhone: "+7 900 000-00-00",
      status: "paused"
    }
  });

  const badaevskyProject = await prisma.project.upsert({
    where: { id: "seed-badaevsky-project" },
    update: {
      name: "Бадаевский",
      city: "Москва",
      district: "Дорогомилово",
      description:
        "Премиальный жилой комплекс Capital Group на Кутузовском проспекте с парящими домами, историческими корпусами завода и первой линией Москвы-реки.",
      salesHeadline:
        "Архитектурный премиум-проект у реки рядом с Москва-Сити от Capital Group и Herzog & de Meuron.",
      handoffPhone: "+7 495 000-00-00",
      status: "active"
    },
    create: {
      id: "seed-badaevsky-project",
      name: "Бадаевский",
      city: "Москва",
      district: "Дорогомилово",
      description:
        "Премиальный жилой комплекс Capital Group на Кутузовском проспекте с парящими домами, историческими корпусами завода и первой линией Москвы-реки.",
      salesHeadline:
        "Архитектурный премиум-проект у реки рядом с Москва-Сити от Capital Group и Herzog & de Meuron.",
      handoffPhone: "+7 495 000-00-00",
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

  const oneRoomListingUrl =
    "https://yandex.ru/realty/kupit/kvartira/novostroyki?erid=5C7FMwRgLbGKaoPdZeqndjTTd79qNriMdgXbpxmJsjD3mbYQsvYjJAGKoNwChVFd&geoid=213&newbuilding_id=%D0%96%D0%9A+%D0%91%D0%B0%D0%B4%D0%B0%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9-1990121&offer_rooms_count=1";
  const twoRoomListingUrl =
    "https://yandex.ru/realty/kupit/kvartira/novostroyki?erid=5C7FMwRgLbGKaoPdZeqndjTTd79qNriMdgXbpxmJsjD3mbYQsvYjJAGKoNwChVFd&geoid=213&newbuilding_id=%D0%96%D0%9A+%D0%91%D0%B0%D0%B4%D0%B0%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9-1990121&offer_rooms_count=2";
  const threeRoomListingUrl =
    "https://yandex.ru/realty/kupit/kvartira/novostroyki?erid=5C7FMwRgLbGKaoPdZeqndjTTd79qNriMdgXbpxmJsjD3mbYQsvYjJAGKoNwChVFd&geoid=213&newbuilding_id=%D0%96%D0%9A+%D0%91%D0%B0%D0%B4%D0%B0%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9-1990121&offer_rooms_count=3";

  const badaevskyUnits = [
    {
      code: "BAD-3-1401-17",
      projectId: badaevskyProject.id,
      rooms: 3,
      floor: 17,
      areaSqm: 140.1,
      priceRub: 309000000,
      finishing: "не указано",
      status: "available",
      listingUrl: threeRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-3-1401-17-preview.jpg",
        "/public/plans/badaevsky/BAD-3-1401-17-plan.jpg"
      ],
      perks: [
        "вид на Москва-Сити",
        "премиальный проект Capital Group",
        "первая линия реки",
        "архитектура Herzog & de Meuron"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 3-комнатная квартира, 140.1 м2, 17 этаж из 18, цена 309 000 000 ₽."
    },
    {
      code: "BAD-3-1295-14",
      projectId: badaevskyProject.id,
      rooms: 3,
      floor: 14,
      areaSqm: 129.5,
      priceRub: 215000000,
      finishing: "не указано",
      status: "available",
      listingUrl: threeRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-3-1295-14-preview.jpg",
        "/public/plans/badaevsky/BAD-3-1295-14-plan.jpg"
      ],
      perks: [
        "видовой этаж",
        "премиальный проект Capital Group",
        "рядом Москва-Сити",
        "архитектура Herzog & de Meuron"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 3-комнатная квартира, 129.5 м2, 14 этаж из 18, цена 215 000 000 ₽."
    },
    {
      code: "BAD-3-1341-10",
      projectId: badaevskyProject.id,
      rooms: 3,
      floor: 10,
      areaSqm: 134.1,
      priceRub: 180500000,
      finishing: "не указано",
      status: "available",
      listingUrl: threeRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-3-1341-10-preview.jpg",
        "/public/plans/badaevsky/BAD-3-1341-10-plan.jpg"
      ],
      perks: [
        "большая кухня-гостиная",
        "премиальный проект Capital Group",
        "виды на реку и город",
        "рядом Москва-Сити"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 3-комнатная квартира, 134.1 м2, 10 этаж из 18, цена 180 500 000 ₽."
    },
    {
      code: "BAD-1-473-13",
      projectId: badaevskyProject.id,
      rooms: 1,
      floor: 13,
      areaSqm: 47.3,
      priceRub: 75000000,
      finishing: "не указано",
      status: "available",
      listingUrl: oneRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-1-473-13-preview.jpg",
        "/public/plans/badaevsky/BAD-1-473-13-plan.jpg"
      ],
      perks: [
        "входной однокомнатный лот",
        "видовой 13 этаж",
        "премиальный проект у реки",
        "архитектура Herzog & de Meuron"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 1-комнатная квартира, 47.3 м2, 13 этаж из 18, цена 75 000 000 ₽."
    },
    {
      code: "BAD-1-594-17",
      projectId: badaevskyProject.id,
      rooms: 1,
      floor: 17,
      areaSqm: 59.4,
      priceRub: 95500000,
      finishing: "без отделки",
      status: "available",
      listingUrl: oneRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-1-594-17-preview.jpg",
        "/public/plans/badaevsky/BAD-1-594-17-plan.jpg"
      ],
      perks: [
        "высокий 17 этаж",
        "премиальный проект у Москвы-реки",
        "панорамные виды",
        "рядом Москва-Сити"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 1-комнатная квартира, 59.4 м2, 17 этаж из 18, цена 95 500 000 ₽."
    },
    {
      code: "BAD-1-600-10",
      projectId: badaevskyProject.id,
      rooms: 1,
      floor: 10,
      areaSqm: 60.0,
      priceRub: 84000000,
      finishing: "не указано",
      status: "available",
      listingUrl: oneRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-1-600-10-preview.jpg",
        "/public/plans/badaevsky/BAD-1-600-10-plan.jpg"
      ],
      perks: [
        "компактный premium формат",
        "видовой 10 этаж",
        "индивидуальный балкон",
        "панорамное остекление"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 1-комнатная квартира, 60.0 м2, 10 этаж из 18, цена 84 000 000 ₽."
    },
    {
      code: "BAD-2-1445-14",
      projectId: badaevskyProject.id,
      rooms: 2,
      floor: 14,
      areaSqm: 144.5,
      priceRub: 199000000,
      finishing: "без отделки",
      status: "available",
      listingUrl: twoRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-2-1445-14-preview.jpg",
        "/public/plans/badaevsky/BAD-2-1445-14-plan.jpg"
      ],
      perks: [
        "большая двухкомнатная планировка",
        "видовой 14 этаж",
        "первая линия реки",
        "панорамные окна"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 2-комнатная квартира, 144.5 м2, 14 этаж из 18, цена 199 000 000 ₽."
    },
    {
      code: "BAD-2-614-13",
      projectId: badaevskyProject.id,
      rooms: 2,
      floor: 13,
      areaSqm: 61.4,
      priceRub: 83500000,
      finishing: "не указано",
      status: "available",
      listingUrl: twoRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-2-614-13-preview.jpg",
        "/public/plans/badaevsky/BAD-2-614-13-plan.jpg"
      ],
      perks: [
        "компактная двухкомнатная планировка",
        "13 этаж",
        "лоджия",
        "проект у реки"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 2-комнатная квартира, 61.4 м2, 13 этаж из 18, цена 83 500 000 ₽."
    },
    {
      code: "BAD-2-765-15",
      projectId: badaevskyProject.id,
      rooms: 2,
      floor: 15,
      areaSqm: 76.5,
      priceRub: 107000000,
      finishing: "не указано",
      status: "available",
      listingUrl: twoRoomListingUrl,
      planImageUrls: [
        "/public/plans/badaevsky/BAD-2-765-15-preview.jpg",
        "/public/plans/badaevsky/BAD-2-765-15-plan.jpg"
      ],
      perks: [
        "видовой 15 этаж",
        "двухкомнатный формат для жизни или инвестиции",
        "премиальный проект у реки",
        "рядом Москва-Сити"
      ],
      notes:
        "Источник: скрины пользователя и Яндекс Недвижимость. 2-комнатная квартира, 76.5 м2, 15 этаж из 18, цена 107 000 000 ₽."
    }
  ];

  for (const unit of badaevskyUnits) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: unit,
      create: unit
    });
  }

  const playbook = readFileSync(
    resolve(process.cwd(), "content/playbook/sales-playbook.md"),
    "utf8"
  );
  const badaevsky = readFileSync(
    resolve(process.cwd(), "content/knowledge/badaevsky.md"),
    "utf8"
  );
  const developerSalesTraining = readFileSync(
    resolve(process.cwd(), "content/knowledge/developer-sales-training.md"),
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

  await prisma.knowledgeDocument.upsert({
    where: { id: "seed-badaevsky" },
    update: {
      title: "ЖК Бадаевский",
      kind: "faq",
      tags: ["badaevsky", "capital-group", "premium", "moscow", "knowledge-pack"],
      body: badaevsky,
      excerpt:
        "Подробный knowledge pack по ЖК Бадаевский: концепция, форматы, сроки, инфраструктура и публичные ценовые ориентиры.",
      embeddingStatus: "pending"
    },
    create: {
      id: "seed-badaevsky",
      title: "ЖК Бадаевский",
      kind: "faq",
      tags: ["badaevsky", "capital-group", "premium", "moscow", "knowledge-pack"],
      body: badaevsky,
      excerpt:
        "Подробный knowledge pack по ЖК Бадаевский: концепция, форматы, сроки, инфраструктура и публичные ценовые ориентиры.",
      embeddingStatus: "pending"
    }
  });

  await prisma.knowledgeDocument.upsert({
    where: { id: "seed-developer-sales-training" },
    update: {
      title: "Обучение продажам в девелопменте",
      kind: "sales_script",
      tags: [
        "sales-training",
        "developer",
        "new-builds",
        "objections",
        "enablement"
      ],
      body: developerSalesTraining,
      excerpt:
        "Внутренний knowledge doc о том, как продавать квартиры и новостройки в девелопменте: логика вопросов, возражения, tone of voice и опорные обучающие ресурсы.",
      embeddingStatus: "pending"
    },
    create: {
      id: "seed-developer-sales-training",
      title: "Обучение продажам в девелопменте",
      kind: "sales_script",
      tags: [
        "sales-training",
        "developer",
        "new-builds",
        "objections",
        "enablement"
      ],
      body: developerSalesTraining,
      excerpt:
        "Внутренний knowledge doc о том, как продавать квартиры и новостройки в девелопменте: логика вопросов, возражения, tone of voice и опорные обучающие ресурсы.",
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
