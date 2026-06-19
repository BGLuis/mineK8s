import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ServersService } from '../../core/services/servers';

@Component({
  selector: 'app-server-files',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './server-files.html',
  styleUrls: ['./server-files.css']
})
export class ServerFiles implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private serversService = inject(ServersService);

  serverId = '';
  currentPath = signal<string>('');
  files = signal<any[]>([]);
  isLoading = signal(true);
  
  viewingFile = signal<{name: string, content: string, path: string} | null>(null);

  ngOnInit() {
    this.serverId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.serverId) {
      this.router.navigate(['/']);
      return;
    }
    this.loadDirectory('');
  }

  loadDirectory(path: string) {
    this.isLoading.set(true);
    this.viewingFile.set(null);
    this.serversService['http'].get<any>(`${this.serversService['apiUrl']}/${this.serverId}/files?path=${path}`).subscribe({
      next: (res) => {
        // Formatar o caminho (remover prefixo /data se a API mandar)
        let displayPath = res.path.replace('/data', '');
        if (displayPath.startsWith('/')) displayPath = displayPath.substring(1);
        this.currentPath.set(displayPath);
        this.files.set(res.files);
        this.isLoading.set(false);
      },
      error: () => {
        alert('Erro ao carregar diretório. Servidor pode estar offline.');
        this.isLoading.set(false);
      }
    });
  }

  openItem(file: any) {
    const nextPath = this.currentPath() ? `${this.currentPath()}/${file.name}` : file.name;
    
    if (file.isDir) {
      this.loadDirectory(nextPath);
    } else {
      // Se for arquivo, chama a rota de leitura!
      this.isLoading.set(true);
      this.serversService['http'].get<any>(`${this.serversService['apiUrl']}/${this.serverId}/file?path=${nextPath}`).subscribe({
        next: (res) => {
          this.viewingFile.set({ name: file.name, content: res.content, path: nextPath });
          this.isLoading.set(false);
        },
        error: () => {
          alert('Erro ao ler arquivo. Talvez seja um binário (.jar) ou permissão negada.');
          this.isLoading.set(false);
        }
      });
    }
  }

  saveFile() {
    const file = this.viewingFile();
    if (!file) return;

    this.isLoading.set(true);
    this.serversService['http'].put(`${this.serversService['apiUrl']}/${this.serverId}/file?path=${file.path}`, { content: file.content }).subscribe({
      next: () => {
        alert('Arquivo salvo com sucesso!');
        this.isLoading.set(false);
      },
      error: (err) => {
        alert('Erro ao salvar arquivo: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  deleteFile(file: any, event: Event) {
    event.stopPropagation();
    
    if (!confirm(`Tem certeza que deseja deletar "${file.name}"? Esta ação é irreversível.`)) return;

    const targetPath = this.currentPath() ? `${this.currentPath()}/${file.name}` : file.name;
    this.isLoading.set(true);
    
    this.serversService['http'].delete(`${this.serversService['apiUrl']}/${this.serverId}/file?path=${targetPath}`).subscribe({
      next: () => {
        this.loadDirectory(this.currentPath()); // recarrega a pasta
      },
      error: (err) => {
        alert('Erro ao deletar: ' + err.message);
        this.isLoading.set(false);
      }
    });
  }

  goUp() {
    if (!this.currentPath()) return;
    const parts = this.currentPath().split('/');
    parts.pop();
    this.loadDirectory(parts.join('/'));
  }

  closeFile() {
    this.viewingFile.set(null);
  }

  goBackToManager() {
    this.router.navigate(['/']);
  }
}
