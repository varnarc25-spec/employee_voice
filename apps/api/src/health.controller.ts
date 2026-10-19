import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health(): { status: "ok"; service: string } {
    return { status: "ok", service: "employee-voice-nest" };
  }
}
