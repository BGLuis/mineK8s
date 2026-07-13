import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ServersService } from '../../core/services/servers';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { ConfigRowComponent } from '../../shared/components/config-row/config-row.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
	selector: 'app-server-details',
	standalone: true,
	imports: [
		CommonModule,
		RouterLink,
		ButtonComponent,
		ConfigRowComponent,
		IconComponent,
	],
	templateUrl: './server-details.component.html',
	styleUrls: ['./server-details.component.scss'],
})
export class ServerDetailsComponent implements OnInit {
	serverId = '';
	server = signal<any | null>(null);
	isLoading = signal(true);

	constructor(
		private route: ActivatedRoute,
		private router: Router,
		private serversService: ServersService,
	) {}

	ngOnInit() {
		this.serverId = this.route.snapshot.paramMap.get('id') || '';
		if (this.serverId) {
			this.fetchServer();
		}
	}

	fetchServer() {
		this.isLoading.set(true);
		// Since getServers returns an array of all servers, we find the specific one locally
		this.serversService.getServers().subscribe({
			next: (servers) => {
				const found = servers.find((s) => s.id === this.serverId);
				this.server.set(found || null);
				this.isLoading.set(false);
			},
			error: (err) => {
				console.error('Error fetching servers', err);
				this.isLoading.set(false);
			},
		});
	}

	goBack() {
		this.router.navigate(['/']);
	}

	isUploading = signal(false);

	triggerUpload() {
		document.getElementById('worldUploadInput')?.click();
	}

	onFileSelected(event: any) {
		const file = event.target.files[0];
		if (file) {
			if (
				!confirm(
					`Deseja realmente fazer o upload do mundo "${file.name}"?\nIsso substituirá o mundo atual!`,
				)
			) {
				event.target.value = ''; // Reset input
				return;
			}
			this.isUploading.set(true);
			this.serversService.uploadWorld(this.serverId, file).subscribe({
				next: () => {
					alert(
						'Upload e substituição do mundo concluídos com sucesso!',
					);
					this.isUploading.set(false);
					this.fetchServer();
				},
				error: (err) => {
					console.error(err);
					alert('Erro ao fazer upload do mundo.');
					this.isUploading.set(false);
				},
			});
			event.target.value = ''; // Reset input
		}
	}

	changeDomain() {
		const currentDomain = this.server()?.connectionDomain || '';
		const newDomain = prompt(
			'Digite o novo domínio para este servidor:',
			currentDomain,
		);

		if (
			newDomain !== null &&
			newDomain.trim() !== '' &&
			newDomain !== currentDomain
		) {
			this.serversService
				.updateDomain(this.serverId, newDomain.trim())
				.subscribe({
					next: () => {
						alert(
							'Domínio atualizado com sucesso! Pode levar alguns segundos para o proxy aplicar a mudança.',
						);
						this.fetchServer();
					},
					error: (err) => {
						console.error(err);
						alert('Erro ao atualizar o domínio.');
					},
				});
		}
	}

	getMemoryPercent(server: any): number {
		if (!server?.metrics?.memoryMb || !server?.memoryAllocated) return 0;
		const match = server.memoryAllocated.match(/(\d+)([a-zA-Z]+)/);
		let limitMb = 2048; // default 2G
		if (match) {
			const val = parseInt(match[1], 10);
			const unit = match[2].toUpperCase();
			if (unit === 'G' || unit === 'GB') limitMb = val * 1024;
			else if (unit === 'M' || unit === 'MB') limitMb = val;
		}
		return Math.min(
			100,
			Math.round((server.metrics.memoryMb / limitMb) * 100),
		);
	}

	wakeServer() {
		this.isLoading.set(true);
		this.serversService.startServer(this.serverId).subscribe({
			next: () => {
				alert('Comando enviado. O servidor está acordando!');
				setTimeout(() => this.fetchServer(), 2000);
			},
			error: (err) => {
				console.error(err);
				this.isLoading.set(false);
				alert('Erro ao acordar o servidor.');
			},
		});
	}
}
