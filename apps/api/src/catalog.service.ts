import { Injectable } from "@nestjs/common";
import { Prisma, Project, Unit } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { z } from "zod";

const projectInputSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  district: z.string().min(2),
  description: z.string().min(10),
  salesHeadline: z.string().min(10),
  handoffPhone: z.string().optional(),
  status: z.enum(["active", "paused", "sold_out"]).default("active")
});

const unitInputSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().min(2),
  rooms: z.coerce.number().int().min(0).max(8),
  floor: z.coerce.number().int().min(1).max(120),
  areaSqm: z.coerce.number().positive(),
  priceRub: z.coerce.number().int().positive(),
  finishing: z.string().min(2),
  status: z.enum(["available", "reserved", "sold"]).default("available"),
  availableFrom: z.string().datetime().optional(),
  perks: z.array(z.string()).default([]),
  notes: z.string().optional()
});

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveProject() {
    return this.getRelevantProject();
  }

  async getRelevantProject(messageText?: string) {
    const projects = await this.prisma.project.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "asc" }
    });

    if (!projects.length) {
      return null;
    }

    if (!messageText) {
      return projects[0];
    }

    return this.findRelevantProjectInText(messageText, projects) ?? projects[0];
  }

  async listProjects() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: "desc" }
    });
  }

  async createProject(payload: unknown) {
    const input = projectInputSchema.parse(payload);

    return this.prisma.project.create({
      data: input
    });
  }

  async listUnits() {
    return this.prisma.unit.findMany({
      include: { project: true },
      orderBy: [{ status: "asc" }, { priceRub: "asc" }]
    });
  }

  async createUnit(payload: unknown) {
    const input = unitInputSchema.parse(payload);

    return this.prisma.unit.create({
      data: {
        ...input,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : undefined
      }
    });
  }

  async updateUnit(id: string, payload: unknown) {
    const input = unitInputSchema.partial().parse(payload);

    return this.prisma.unit.update({
      where: { id },
      data: {
        ...input,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : undefined
      }
    });
  }

  async findCandidateUnits(messageText: string) {
    const parsedBudget = this.extractBudget(messageText);
    const parsedRooms = this.extractRooms(messageText);
    const project = await this.getRelevantProject(messageText);
    const where: Prisma.UnitWhereInput = {
      status: "available",
      priceRub: {
        gt: 0
      }
    };

    if (parsedBudget) {
      where.priceRub = { gt: 0, lte: parsedBudget };
    }

    if (parsedRooms !== null) {
      where.rooms = parsedRooms;
    }

    if (project) {
      where.projectId = project.id;
    }

    const units = await this.prisma.unit.findMany({
      where,
      include: { project: true },
      take: 6,
      orderBy: [{ priceRub: "asc" }, { areaSqm: "desc" }]
    });

    return units;
  }

  extractBudget(messageText: string) {
    const normalized = messageText.toLowerCase().replace(/\s/g, "");
    const matchMillion = normalized.match(/(\d+(?:[.,]\d+)?)млн/);

    if (matchMillion) {
      return Math.round(Number(matchMillion[1].replace(",", ".")) * 1_000_000);
    }

    const matchRaw = normalized.match(/(\d{6,9})/);

    if (matchRaw) {
      return Number(matchRaw[1]);
    }

    return null;
  }

  extractRooms(messageText: string) {
    const normalized = messageText.toLowerCase();
    const studios = ["студ", "studio"];
    if (studios.some((token) => normalized.includes(token))) {
      return 0;
    }

    const match = normalized.match(/([1-5])\s*[- ]?\s*(к|комн|комнат)/);
    if (match) {
      return Number(match[1]);
    }

    return null;
  }

  formatUnitsForPrompt(units: Unit[]) {
    return units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      rooms: unit.rooms,
      floor: unit.floor,
      area_sqm: unit.areaSqm,
      price_rub: unit.priceRub,
      finishing: unit.finishing,
      perks: unit.perks
    }));
  }

  private findRelevantProjectInText(messageText: string, projects: Project[]) {
    const normalizedMessage = this.normalizeSearchText(messageText);
    let bestMatch: Project | null = null;
    let bestScore = 0;

    for (const project of projects) {
      const normalizedName = this.normalizeSearchText(project.name);
      const tokens = this.tokenizeSearchText(
        `${project.name} ${project.district} ${project.city}`
      );
      let score = 0;

      if (normalizedName && normalizedMessage.includes(normalizedName)) {
        score += 10;
      }

      for (const token of tokens) {
        if (token.length >= 4 && normalizedMessage.includes(token)) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = project;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  private normalizeSearchText(value: string) {
    return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
  }

  private tokenizeSearchText(value: string) {
    return Array.from(new Set(this.normalizeSearchText(value).split(/\s+/).filter(Boolean)));
  }
}
