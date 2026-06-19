import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BackupsService, BackupFile } from '../../core/services/backups.service';

@Component({
  selector: 'app-server-backups',
  standalone: true,
  imports: [CommonModule],
  providers: [DatePipe],
  templateUrl: './server-backups.html',
  styleUrls: ['./server-backups.scss']
})
export class ServerBackups implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private backupsService = inject(BackupsService);

  serverId = '';
  backups = signal<BackupFile[]>([]);
  isLoading = signal(true);
  isActionInProgress = signal(false);

  ngOnInit() {
    this.serverId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.serverId) {
      this.router.navigate(['/']);
      return;
    }
    this.fetchBackups();
  }

  fetchBackups() {
    this.isLoading.set(true);
    this.backupsService.listBackups(this.serverId).subscribe({
      next: (res) => {
        this.backups.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        alert('Erro ao carregar backups: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  createBackup() {
    this.isActionInProgress.set(true);
    this.backupsService.createBackup(this.serverId).subscribe({
      next: (res) => {
        alert(`Backup iniciado! Job criado: ${res.jobName}. Você pode atualizar a lista em alguns minutos.`);
        this.isActionInProgress.set(false);
      },
      error: (err) => {
        alert('Erro ao iniciar backup: ' + err.message);
        this.isActionInProgress.set(false);
      }
    });
  }

  restoreBackup(filename: string) {
    if (!confirm(`TEM CERTEZA? Restaurar o backup apagará os dados atuais do mundo e os substituirá por "${filename}".\n\nO SERVIDOR DEVE ESTAR DESLIGADO! Continuar?`)) return;

    this.isActionInProgress.set(true);
    this.backupsService.restoreBackup(this.serverId, filename).subscribe({
      next: (res) => {
        alert(`Restauração iniciada! Job: ${res.jobName}. O mundo estará pronto quando a restauração for concluída.`);
        this.isActionInProgress.set(false);
      },
      error: (err) => {
        // Exibe erro com status 409 (Conflict) se o servidor estiver online
        const msg = err.error?.message || err.message;
        alert('Erro ao restaurar: ' + msg);
        this.isActionInProgress.set(false);
      }
    });
  }

  goBack() {
    this.router.navigate(['/']);
  }
}
