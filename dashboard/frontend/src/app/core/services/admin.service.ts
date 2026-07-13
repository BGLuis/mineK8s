import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface User {
	id: string;
	tailscaleUserId: string;
	email?: string;
	minecraftNick: string;
	groups?: Group[];
}

export interface Group {
	id: string;
	name: string;
	description?: string;
	users?: User[];
}

@Injectable({ providedIn: 'root' })
export class AdminService {
	private http = inject(HttpClient);
	private apiUrl = '/api/admin';

	getUsers() {
		return this.http.get<User[]>(`${this.apiUrl}/users`);
	}

	createUser(data: Partial<User>) {
		return this.http.post<User>(`${this.apiUrl}/users`, data);
	}

	getGroups() {
		return this.http.get<Group[]>(`${this.apiUrl}/groups`);
	}

	createGroup(data: Partial<Group>) {
		return this.http.post<Group>(`${this.apiUrl}/groups`, data);
	}

	addUserToGroup(groupId: string, userId: string) {
		return this.http.post(
			`${this.apiUrl}/groups/${groupId}/users/${userId}`,
			{},
		);
	}

	removeUserFromGroup(groupId: string, userId: string) {
		return this.http.delete(
			`${this.apiUrl}/groups/${groupId}/users/${userId}`,
		);
	}
}
