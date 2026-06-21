import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from './layout/sidebar/sidebar';
import { NgClass } from '@angular/common';
import { IconComponent } from './shared/components/icon/icon.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Sidebar, NgClass, IconComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  title = 'MineK8s Dashboard';
  isSidebarOpen = false;

  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }
}
