import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TailscaleService, CreateInviteDto } from '../../core/services/tailscale.service';
import { ServersService } from '../../core/services/servers';

@Component({
  selector: 'app-tailscale-network',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tailscale-network.html',
  styleUrls: ['./tailscale-network.scss']
})
export class TailscaleNetwork implements OnInit {
  private tailscaleService = inject(TailscaleService);
  private serversService = inject(ServersService);

  devices = signal<any[]>([]);
  servers = signal<any[]>([]);
  isLoading = signal(false);

  // Formulário de convite
  inviteModel: CreateInviteDto = {
    playerName: '',
    scope: 'global',
    serverIds: [],
    expiresInDays: 7
  };
  
  generatedInviteUrl = signal<string | null>(null);

  ngOnInit() {
    this.fetchDevices();
    this.fetchServers();
  }

  fetchDevices() {
    this.isLoading.set(true);
    this.tailscaleService.listDevices().subscribe({
      next: (res) => {
        this.devices.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.isLoading.set(false);
      }
    });
  }

  fetchServers() {
    this.serversService.getServers().subscribe({
      next: (res) => this.servers.set(res),
      error: (err) => console.error(err)
    });
  }

  createInvite() {
    if (!this.inviteModel.playerName) {
      alert('Nome do jogador é obrigatório');
      return;
    }

    if (this.inviteModel.scope !== 'global' && (!this.inviteModel.serverIds || this.inviteModel.serverIds.length === 0)) {
      alert('Selecione pelo menos um servidor para o acesso não-global.');
      return;
    }

    this.isLoading.set(true);
    this.tailscaleService.createInvite(this.inviteModel).subscribe({
      next: (res) => {
        this.generatedInviteUrl.set(res.inviteUrl);
        this.isLoading.set(false);
      },
      error: (err) => {
        alert('Erro ao criar convite: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  revokeDevice(deviceId: string, playerName: string) {
    if (!confirm(`Tem certeza que deseja remover (kick) o jogador ${playerName} da rede?`)) return;

    this.isLoading.set(true);
    this.tailscaleService.revokeDevice(deviceId).subscribe({
      next: () => {
        this.fetchDevices(); // recarrega a lista
      },
      error: (err) => {
        alert('Erro ao remover jogador: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }
}
