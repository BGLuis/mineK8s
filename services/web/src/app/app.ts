import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { McDialogHost, McToast } from './ui';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, McToast, McDialogHost],
  template: `
    <router-outlet />
    <mc-toast />
    <mc-dialog-host />
  `,
})
export class App {}
