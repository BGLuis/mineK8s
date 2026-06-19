import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ServersService } from '../../core/services/servers';
import { MonitoringService, ServerMetrics } from '../../core/services/monitoring.service';

@Component({
  selector: 'app-server-manager',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './server-manager.html',
  styleUrl: './server-manager.scss'
})
export class ServerManager implements OnInit {
  servers = signal<any[]>([]);
  isLoading = signal(false);

  constructor(
    private serversService: ServersService,
    private monitoringService: MonitoringService
  ) {}

  ngOnInit() {
    this.fetchServers();
  }

  fetchServers() {
    this.isLoading.set(true);
    this.serversService.getServers().subscribe({
      next: (data) => {
        // Inicializa servidores com métricas zeradas
        const serversWithMetrics = data.map((s: any) => ({ ...s, metrics: null }));
        this.servers.set(serversWithMetrics);
        this.isLoading.set(false);
        this.fetchMetrics(); // Busca métricas assincronamente
      },
      error: (err) => {
        console.error(err);
        this.isLoading.set(false);
      }
    });
  }

  fetchMetrics() {
    this.monitoringService.getAllMetrics().subscribe({
      next: (metricsData) => {
        this.servers.update(currentServers => {
          return currentServers.map(server => {
            const m = metricsData.find(md => md.serverId === server.id);
            if (m) {
              return { ...server, metrics: m };
            }
            return server;
          });
        });
      },
      error: (err) => console.warn('Não foi possível carregar métricas', err)
    });
  }

  startServer(id: string) {
    this.serversService.startServer(id).subscribe({
      next: () => this.fetchServers(),
      error: (e) => alert('Erro ao ligar: ' + e.message)
    });
  }

  stopServer(id: string) {
    if (confirm('Tem certeza que deseja desligar este servidor?')) {
      this.serversService.stopServer(id).subscribe({
        next: () => this.fetchServers(),
        error: (e) => alert('Erro ao desligar: ' + e.message)
      });
    }
  }

  deleteServer(id: string) {
    if (confirm('AVISO: Isso vai deletar o mundo inteiro! Tem certeza?')) {
      this.serversService.deleteServer(id).subscribe({
        next: () => this.fetchServers(),
        error: (e) => alert('Erro ao excluir: ' + e.message)
      });
    }
  }
}
