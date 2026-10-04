import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'mc-legal-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <footer class="t-caption px-4 py-6 text-center text-text-muted">
      Não é um produto oficial do Minecraft. Não aprovado nem associado à Mojang ou à Microsoft.
    </footer>
  `,
})
export class McLegalFooter {}
