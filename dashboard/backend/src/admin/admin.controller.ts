import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('api/admin')
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	@Get('players/online')
	getOnlinePlayers() {
		return this.adminService.getOnlinePlayers();
	}

	@Post('users')
	createUser(@Body() body: CreateUserDto) {
		return this.adminService.createUser(body);
	}

	@Get('users')
	getUsers() {
		return this.adminService.getUsers();
	}

	@Post('groups')
	createGroup(@Body() body: CreateGroupDto) {
		return this.adminService.createGroup(body);
	}

	@Get('groups')
	getGroups() {
		return this.adminService.getGroups();
	}

	@Post('servers')
	createServer(@Body() body: CreateServerDto) {
		return this.adminService.createServer(body);
	}

	@Get('servers')
	getServers() {
		return this.adminService.getServers();
	}

	@Patch('servers/:serverId')
	updateServer(
		@Param('serverId') serverId: string,
		@Body() body: { name?: string; subdomain?: string },
	) {
		return this.adminService.updateServer(serverId, body);
	}

	@Post('groups/:groupId/users/:userId')
	addUserToGroup(
		@Param('groupId') groupId: string,
		@Param('userId') userId: string,
	) {
		return this.adminService.addUserToGroup(userId, groupId);
	}

	@Post('groups/:groupId/servers/:serverId')
	addServerToGroup(
		@Param('groupId') groupId: string,
		@Param('serverId') serverId: string,
	) {
		return this.adminService.addServerToGroup(serverId, groupId);
	}

	@Delete('groups/:groupId/users/:userId')
	removeUserFromGroup(
		@Param('groupId') groupId: string,
		@Param('userId') userId: string,
	) {
		return this.adminService.removeUserFromGroup(userId, groupId);
	}
}
