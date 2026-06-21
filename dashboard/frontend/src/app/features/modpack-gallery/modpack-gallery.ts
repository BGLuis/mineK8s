import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModpacksService, ModpackResult } from '../../core/services/modpacks';
import { ServersService } from '../../core/services/servers';
import { ModpackCardComponent, ModpackInfo } from '../../shared/components/modpack-card/modpack-card.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { ButtonComponent } from '../../shared/components/button/button.component';

@Component({
  selector: 'app-modpack-gallery',
  standalone: true,
  imports: [CommonModule, FormsModule, ModpackCardComponent, InputComponent, ButtonComponent],
  templateUrl: './modpack-gallery.html',
  styleUrl: './modpack-gallery.scss'
})
export class ModpackGallery implements OnInit {
  searchQuery = signal('');
  selectedSource = signal('All');
  modpacks = signal<ModpackResult[]>([]);
  isLoading = signal(false);

  constructor(
    private modpacksService: ModpacksService,
    private serversService: ServersService
  ) {}

  versions = signal<any[]>([]);
  isFetchingVersions = signal(false);
  selectingVersionFor = signal<ModpackResult | null>(null);

  ngOnInit() {
    this.search();
  }

  search() {
    this.isLoading.set(true);
    
    this.modpacksService.search(this.searchQuery(), 20, this.selectedSource()).subscribe({
      next: (res) => {
        this.modpacks.set(res.results || []);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.modpacks.set([]);
        this.isLoading.set(false);
      }
    });
  }

  openVersionsModal(pack: ModpackResult) {
    this.selectingVersionFor.set(pack);
    this.isFetchingVersions.set(true);
    this.versions.set([]);
    
    this.modpacksService.getVersions(pack.id, pack.source).subscribe({
      next: (res) => {
        this.versions.set(res || []);
        this.isFetchingVersions.set(false);
      },
      error: () => {
        alert('Erro ao buscar versões.');
        this.closeModal();
      }
    });
  }

  closeModal() {
    this.selectingVersionFor.set(null);
    this.versions.set([]);
  }

  installVersion(pack: ModpackResult, versionId: string | null) {
    const customName = prompt(`Que nome você quer dar para o seu novo servidor de ${pack.title}?`, pack.title);
    
    if (customName && customName.trim() !== '') {
      this.serversService.createServer({
        modpackId: pack.id,
        modpackSlug: pack.slug,
        name: customName.trim(),
        source: pack.source,
        ...(versionId && { version: versionId })
      }).subscribe({
        next: (res) => {
          alert(res.message);
          this.closeModal();
        },
        error: (err) => alert('Erro ao criar servidor: ' + err.message)
      });
    }
  }

  installVanilla() {
    const customName = prompt(`Que nome você quer dar para o seu novo servidor Vanilla?`, 'Meu Servidor Vanilla');
    if (!customName || customName.trim() === '') return;

    const versionStr = prompt(`Qual versão do Minecraft você quer rodar? (Ex: 1.20.4, 1.18.2, 1.8.9)\nDeixe como 'LATEST' para instalar a versão mais nova automaticamente.`, 'LATEST');
    if (!versionStr) return;

    this.serversService.createServer({
      name: customName.trim(),
      source: 'Vanilla',
      version: versionStr.trim()
    }).subscribe({
      next: (res) => alert(res.message),
      error: (err) => alert('Erro ao criar servidor Vanilla: ' + err.message)
    });
  }

  mapToModpackInfo(pack: ModpackResult): ModpackInfo {
    return {
      name: pack.title,
      author: pack.author,
      description: pack.description || '',
      coverUrl: pack.iconUrl,
      updatedAt: new Date(),
      version: pack.versions && pack.versions.length ? pack.versions[0] : 'Unknown',
      loader: pack.categories && pack.categories.includes('Fabric') ? 'Fabric' : 'Forge'
    };
  }
}
