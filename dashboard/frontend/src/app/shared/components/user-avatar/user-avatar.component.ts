import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-avatar.component.html',
  styleUrls: ['./user-avatar.component.scss']
})
export class UserAvatarComponent {
  // Can be UUID or username (though Crafatar prefers UUID, Minotar works with usernames)
  identifier = input<string>('MHF_Steve');
  isOnline = input<boolean>(true);
  type = input<'2d' | '3d'>('2d');

  imageUrl = computed(() => {
    const id = this.identifier() || 'MHF_Steve';
    if (this.type() === '3d') {
      // Using minotar for 3d body (or crafatar if uuid)
      return `https://minotar.net/armor/body/${id}/200.png`;
    }
    // 2d head
    return `https://minotar.net/helm/${id}/200.png`;
  });

  handleError(event: Event) {
    const img = event.target as HTMLImageElement;
    // Fallback to Steve if the custom skin fails to load
    img.src = this.type() === '3d' 
      ? 'https://minotar.net/armor/body/MHF_Steve/200.png'
      : 'https://minotar.net/helm/MHF_Steve/200.png';
  }
}
