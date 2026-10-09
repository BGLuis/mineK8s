import { CanDeactivateFn } from '@angular/router';
import { ServerFilesPage } from './server-files.page';

/** Warns about unsaved file edits before navigating away from the Files tab. */
export const canDeactivateFiles: CanDeactivateFn<ServerFilesPage> = (component) => {
  return component.canDeactivate();
};
