import { Component, OnInit, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ServersService } from '../../core/services/servers';

@Component({
  selector: 'app-server-console',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './server-console.html',
  styleUrls: ['./server-console.css']
})
export class ServerConsole implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private serversService = inject(ServersService);

  serverId = '';
  logs = signal<string>('Carregando terminal...');
  players = signal<any[]>([]);
  commandInput = signal<string>('');
  
  suggestions = signal<string[]>([]);
  showSuggestions = signal<boolean>(false);
  activeSuggestionIndex = signal<number>(0);

  private logTimer: any;
  private playerTimer: any;

  readonly BASE_COMMANDS = [
    'gamemode survival', 'gamemode creative', 'gamemode spectator',
    'give', 'time set day', 'time set night', 'weather clear', 
    'weather rain', 'tp', 'op', 'deop', 'kick', 'ban', 'say', 'list', 'stop'
  ];

  ngOnInit() {
    this.serverId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.serverId) {
      this.router.navigate(['/']);
      return;
    }

    this.fetchLogs();
    this.fetchPlayers();

    // Polling logs every 3 seconds
    this.logTimer = setInterval(() => this.fetchLogs(), 3000);
    // Polling players every 10 seconds
    this.playerTimer = setInterval(() => this.fetchPlayers(), 10000);
  }

  ngOnDestroy() {
    clearInterval(this.logTimer);
    clearInterval(this.playerTimer);
  }

  fetchLogs() {
    this.serversService['http'].get<any>(`${this.serversService['apiUrl']}/${this.serverId}/logs`).subscribe({
      next: (res) => {
        if (res.logs) {
          // Filtra os logs chatos do RCON que ficam aparecendo a cada 10 segundos
          const filteredLogs = res.logs
            .split('\n')
            .filter((line: string) => !line.includes('Thread RCON Client') && !line.includes('RCON Listener'))
            .join('\n');
          this.logs.set(filteredLogs || 'Sem logs disponíveis.');
        } else {
          this.logs.set('Sem logs disponíveis.');
        }
        this.scrollToBottom();
      },
      error: () => this.logs.set('Servidor offline ou erro ao ler logs.')
    });
  }

  fetchPlayers() {
    this.serversService['http'].get<any>(`${this.serversService['apiUrl']}/${this.serverId}/players`).subscribe({
      next: (res) => this.players.set(res.players || [])
    });
  }

  onInput(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.commandInput.set(val);
    this.updateSuggestions(val);
  }

  updateSuggestions(val: string) {
    if (!val || !val.startsWith('/')) {
      this.showSuggestions.set(false);
      return;
    }

    const search = val.substring(1).toLowerCase(); // remove '/'
    const args = search.split(' ');
    const cmd = args[0];

    let results: string[] = [];

    // Se estiver digitando o comando base
    if (args.length === 1) {
      results = this.BASE_COMMANDS
        .filter(c => c.startsWith(cmd))
        .map(c => '/' + c);
    } 
    // Se estiver digitando o segundo argumento (geralmente um jogador)
    else if (['give', 'tp', 'op', 'deop', 'kick', 'ban'].includes(cmd)) {
      const playerSearch = args[1] || '';
      const playerNames = this.players().map(p => p.name);
      
      results = playerNames
        .filter(p => p.toLowerCase().startsWith(playerSearch))
        .map(p => `/${cmd} ${p}`);
    }

    this.suggestions.set(results);
    this.showSuggestions.set(results.length > 0);
    this.activeSuggestionIndex.set(0);
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.showSuggestions()) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = (this.activeSuggestionIndex() + 1) % this.suggestions().length;
      this.activeSuggestionIndex.set(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = (this.activeSuggestionIndex() - 1 + this.suggestions().length) % this.suggestions().length;
      this.activeSuggestionIndex.set(prev);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.selectSuggestion(this.suggestions()[this.activeSuggestionIndex()]);
    }
  }

  selectSuggestion(suggestion: string) {
    this.commandInput.set(suggestion + ' ');
    this.showSuggestions.set(false);
    // focar no input novamente
    document.getElementById('cmd-input')?.focus();
  }

  sendCommand() {
    let cmdRaw = this.commandInput().trim();
    if (!cmdRaw) return;
    
    let cmd = cmdRaw;
    if (cmd.startsWith('/')) cmd = cmd.substring(1);

    this.serversService['http'].post<any>(`${this.serversService['apiUrl']}/${this.serverId}/command`, { command: cmd }).subscribe({
      next: (res) => {
        this.commandInput.set('');
        this.showSuggestions.set(false);
        
        // Injeta a resposta direta do RCON no topo/fim dos logs temporariamente,
        // porque comandos como /list só respondem pro cliente RCON e não sujam o log do servidor.
        const rconOutput = `> /${cmd}\n[RCON]: ${res.response}\n`;
        this.logs.update(current => current + '\n' + rconOutput);
        this.scrollToBottom();
      },
      error: (e) => {
        alert('Erro ao enviar comando. Servidor pode estar iniciando ainda.');
      }
    });
  }

  scrollToBottom() {
    setTimeout(() => {
      const term = document.getElementById('terminal-box');
      if (term) term.scrollTop = term.scrollHeight;
    }, 100);
  }

  goBack() {
    this.router.navigate(['/']);
  }
}
