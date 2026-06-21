import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ServersService } from '../../core/services/servers';

import { UserAvatarComponent } from '../../shared/components/user-avatar/user-avatar.component';
import { ButtonComponent } from '../../shared/components/button/button.component';

@Component({
  selector: 'app-server-players',
  standalone: true,
  imports: [CommonModule, UserAvatarComponent, ButtonComponent],
  templateUrl: './server-players.html',
  styleUrls: ['./server-players.scss']
})
export class ServerPlayers implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private serversService = inject(ServersService);

  serverId = '';
  players = signal<{name: string}[]>([]);
  onlineCount = signal(0);
  maxCount = signal(0);
  isLoading = signal(true);

  ngOnInit() {
    this.serverId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.serverId) {
      this.router.navigate(['/']);
      return;
    }
    this.fetchPlayers();
  }

  fetchPlayers() {
    this.isLoading.set(true);
    this.serversService.getPlayers(this.serverId).subscribe({
      next: (res) => {
        this.onlineCount.set(res.online);
        this.maxCount.set(res.max);
        this.players.set(res.players.map((p: string) => ({ name: p })));
        this.isLoading.set(false);
      },
      error: () => {
        alert('Erro ao obter jogadores. O servidor está online?');
        this.isLoading.set(false);
      }
    });
  }

  executeCommand(player: string, action: 'kick' | 'ban' | 'op' | 'deop') {
    if (action === 'ban' && !confirm(`Tem certeza que deseja banir ${player}?`)) return;

    const cmd = `${action} ${player}`;
    this.serversService.sendCommand(this.serverId, cmd).subscribe({
      next: () => {
        alert(`Comando '${cmd}' executado com sucesso!`);
        setTimeout(() => this.fetchPlayers(), 1000); // Atualiza a lista
      },
      error: (e) => alert('Erro: ' + e.message)
    });
  }

  getAvatarUrl(playerName: string): string {
    return `https://minotar.net/helm/${playerName}/64.png`;
  }

  goBack() {
    this.router.navigate(['/server', this.serverId, 'dashboard']);
  }
}
