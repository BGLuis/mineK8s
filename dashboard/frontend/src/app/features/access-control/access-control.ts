import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, Group, User } from '../../core/services/admin.service';
import { ServersService } from '../../core/services/servers';
import {
	CreateInviteDto,
	TailscaleService,
} from '../../core/services/tailscale.service';

@Component({
	selector: 'app-access-control',
	standalone: true,
	imports: [CommonModule, FormsModule],
	templateUrl: './access-control.html',
	styleUrls: ['./access-control.scss'],
})
export class AccessControlComponent implements OnInit {
	activeTab = signal<'tailscale' | 'users' | 'groups'>('users');

	private tailscaleService = inject(TailscaleService);
	private serversService = inject(ServersService);
	private adminService = inject(AdminService);

	devices = signal<any[]>([]);
	servers = signal<any[]>([]);
	users = signal<User[]>([]);
	groups = signal<Group[]>([]);
	isLoading = signal(false);

	// Tailscale Invite Form
	inviteModel: CreateInviteDto = {
		playerName: '',
		scope: 'global',
		serverIds: [],
		expiresInDays: 7,
	};
	generatedInviteUrl = signal<string | null>(null);

	// User Form
	newUserModel: Partial<User> = {
		tailscaleUserId: '',
		minecraftNick: '',
		email: '',
	};

	// Group Form
	newGroupModel: Partial<Group> = { name: '', description: '' };

	ngOnInit() {
		this.fetchDevices();
		this.fetchServers();
		this.fetchUsers();
		this.fetchGroups();
	}

	setTab(tab: 'tailscale' | 'users' | 'groups') {
		this.activeTab.set(tab);
	}

	fetchDevices() {
		this.tailscaleService.listDevices().subscribe({
			next: (res) => this.devices.set(res),
			error: (err) => console.error(err),
		});
	}

	fetchServers() {
		this.serversService.getServers().subscribe({
			next: (res) => this.servers.set(res),
			error: (err) => console.error(err),
		});
	}

	fetchUsers() {
		this.adminService.getUsers().subscribe({
			next: (res) => this.users.set(res),
			error: (err) => console.error(err),
		});
	}

	fetchGroups() {
		this.adminService.getGroups().subscribe({
			next: (res) => this.groups.set(res),
			error: (err) => console.error(err),
		});
	}

	// --- Tailscale ---
	createInvite() {
		if (!this.inviteModel.playerName)
			return alert('Nome do jogador é obrigatório');
		this.isLoading.set(true);
		this.tailscaleService.createInvite(this.inviteModel).subscribe({
			next: (res) => {
				this.generatedInviteUrl.set(res.inviteUrl);
				this.isLoading.set(false);
			},
			error: (err) => {
				alert('Erro ao criar convite: ' + err.message);
				this.isLoading.set(false);
			},
		});
	}

	revokeDevice(deviceId: string, playerName: string) {
		if (!confirm(`Remover ${playerName}?`)) return;
		this.tailscaleService.revokeDevice(deviceId).subscribe({
			next: () => this.fetchDevices(),
			error: (err) => alert('Erro: ' + err.message),
		});
	}

	// --- Users ---
	createUser() {
		if (
			!this.newUserModel.minecraftNick ||
			!this.newUserModel.tailscaleUserId
		)
			return alert('Nick e Tailscale ID são obrigatórios');
		this.adminService.createUser(this.newUserModel).subscribe({
			next: () => {
				this.fetchUsers();
				this.newUserModel = {
					tailscaleUserId: '',
					minecraftNick: '',
					email: '',
				};
			},
			error: (err) => alert('Erro: ' + err.message),
		});
	}

	// --- Groups ---
	createGroup() {
		if (!this.newGroupModel.name)
			return alert('Nome do grupo é obrigatório');
		this.adminService.createGroup(this.newGroupModel).subscribe({
			next: () => {
				this.fetchGroups();
				this.newGroupModel = { name: '', description: '' };
			},
			error: (err) => alert('Erro: ' + err.message),
		});
	}
}
