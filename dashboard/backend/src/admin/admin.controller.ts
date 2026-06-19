import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('players/online')
  getOnlinePlayers() {
    return this.adminService.getOnlinePlayers();
  }

  @Post('users')
  createUser(@Body() body: any) {
    return this.adminService.createUser(body);
  }

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Post('groups')
  createGroup(@Body() body: any) {
    return this.adminService.createGroup(body);
  }

  @Get('groups')
  getGroups() {
    return this.adminService.getGroups();
  }

  @Post('servers')
  createServer(@Body() body: any) {
    return this.adminService.createServer(body);
  }

  @Get('servers')
  getServers() {
    return this.adminService.getServers();
  }

  @Post('groups/:groupId/users/:userId')
  addUserToGroup(@Param('groupId') groupId: string, @Param('userId') userId: string) {
    return this.adminService.addUserToGroup(userId, groupId);
  }

  @Post('groups/:groupId/servers/:serverId')
  addServerToGroup(@Param('groupId') groupId: string, @Param('serverId') serverId: string) {
    return this.adminService.addServerToGroup(serverId, groupId);
  }

  @Delete('groups/:groupId/users/:userId')
  removeUserFromGroup(@Param('groupId') groupId: string, @Param('userId') userId: string) {
    return this.adminService.removeUserFromGroup(userId, groupId);
  }
}
