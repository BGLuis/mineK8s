import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';
import { UserRole } from '@database/entities/user.entity';

import { ReconcilerService } from './reconciler.service';

@ApiTags('Reconciliation & Self-Healing')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/reconciler')
export class ReconcilerController {
  constructor(private readonly reconcilerService: ReconcilerService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger an immediate reconciliation cycle (database vs Kubernetes)' })
  @ApiResponse({ status: 200, description: 'Reconciliation summary' })
  async triggerReconciliation() {
    return this.reconcilerService.reconcile();
  }

  @Get('status')
  @ApiOperation({ summary: 'Get the last reconciliation cycle execution summary' })
  @ApiResponse({ status: 200, description: 'Last reconciliation summary' })
  async getStatus() {
    return this.reconcilerService.getLastSummary() || { status: 'idle', message: 'No reconciliation run yet' };
  }
}
