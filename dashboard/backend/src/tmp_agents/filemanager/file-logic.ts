import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class FileManagerAdvanced {
  /**
   * Saves a file inside a specific Kubernetes pod.
   * Uses kubectl exec -i to pipe the file content via stdin.
   *
   * @param podName The name of the target pod
   * @param path The absolute path inside the pod where the file should be saved
   * @param content The text content of the file
   */
  async saveFile(podName: string, path: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = `kubectl exec -i ${podName} -- sh -c "cat > ${path}"`;
      
      const child = exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to save file: ${error.message} - ${stderr}`));
        } else {
          resolve();
        }
      });
      
      if (child.stdin) {
        child.stdin.write(content);
        child.stdin.end();
      } else {
        reject(new Error("Could not access stdin of the child process"));
      }
    });
  }

  /**
   * Deletes a file inside a specific Kubernetes pod.
   * Uses kubectl exec to run rm -f.
   *
   * @param podName The name of the target pod
   * @param path The absolute path inside the pod of the file to delete
   */
  async deleteFile(podName: string, path: string): Promise<void> {
    const command = `kubectl exec ${podName} -- rm -f ${path}`;
    try {
      await execAsync(command);
    } catch (error: any) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}
