import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { ServersService } from '../../core/services/servers';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { ConfigRowComponent } from '../../shared/components/config-row/config-row.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-server-details',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent, ConfigRowComponent, IconComponent],
  templateUrl: './server-details.component.html',
  styleUrls: ['./server-details.component.scss']
})
export class ServerDetailsComponent implements OnInit {
  serverId = '';
  server = signal<any | null>(null);
  isLoading = signal(true);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private serversService: ServersService
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
        const found = servers.find(s => s.id === this.serverId);
        this.server.set(found || null);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching servers', err);
        this.isLoading.set(false);
      }
    });
  }

  goBack() {
    this.router.navigate(['/']);
  }
}
