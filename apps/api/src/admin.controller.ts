import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { KnowledgeService } from "./knowledge.service";
import { LeadService } from "./lead.service";
import { SupportService } from "./support.service";
import { PrismaService } from "./prisma.service";

@Controller("/admin")
export class AdminController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly knowledge: KnowledgeService,
    private readonly leads: LeadService,
    private readonly support: SupportService,
    private readonly prisma: PrismaService
  ) {}

  @Get("/dashboard")
  async dashboard() {
    const [projects, units, leads, supportTickets, knowledgeDocuments, promptVersions] =
      await Promise.all([
        this.catalog.listProjects(),
        this.catalog.listUnits(),
        this.leads.listLeads(),
        this.support.listTickets(),
        this.knowledge.listDocuments(),
        this.prisma.promptVersion.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" }
        })
      ]);

    return {
      projects,
      units,
      leads,
      supportTickets,
      knowledgeDocuments,
      promptVersions
    };
  }

  @Get("/projects")
  projects() {
    return this.catalog.listProjects();
  }

  @Post("/projects")
  createProject(@Body() body: unknown) {
    return this.catalog.createProject(body);
  }

  @Get("/units")
  units() {
    return this.catalog.listUnits();
  }

  @Post("/units")
  createUnit(@Body() body: unknown) {
    return this.catalog.createUnit(body);
  }

  @Patch("/units/:id")
  updateUnit(@Param("id") id: string, @Body() body: unknown) {
    return this.catalog.updateUnit(id, body);
  }

  @Get("/knowledge-documents")
  knowledgeDocuments() {
    return this.knowledge.listDocuments();
  }

  @Post("/knowledge-documents")
  createKnowledgeDocument(@Body() body: unknown) {
    return this.knowledge.createDocument(body);
  }

  @Get("/leads")
  leadsList() {
    return this.leads.listLeads();
  }

  @Post("/leads/:id/assign")
  assignLead(
    @Param("id") id: string,
    @Body() body: { managerName: string; managerChat?: string }
  ) {
    return this.leads.assignLead(id, body);
  }

  @Get("/support-tickets")
  supportTickets() {
    return this.support.listTickets();
  }

  @Post("/support-tickets")
  createSupportTicket(@Body() body: unknown) {
    return this.support.createTicket(body);
  }
}
