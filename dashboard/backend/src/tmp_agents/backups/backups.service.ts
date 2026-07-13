import * as k8s from '@kubernetes/client-node';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BackupsService {
	private readonly logger = new Logger(BackupsService.name);
	private k8sApi: k8s.BatchV1Api;

	constructor() {
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();
		this.k8sApi = kc.makeApiClient(k8s.BatchV1Api);
	}

	async createBackupJob(
		serverId: string,
		namespace: string = 'default',
	): Promise<void> {
		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, '-')
			.toLowerCase();
		const jobName = `backup-${serverId}-${timestamp}`;
		const backupFileName = `${serverId}-${timestamp}.tar.gz`;

		const job = new k8s.V1Job();
		job.metadata = {
			name: jobName,
			namespace: namespace,
		};

		job.spec = {
			ttlSecondsAfterFinished: 3600, // Clean up job after an hour
			template: {
				spec: {
					restartPolicy: 'Never',
					containers: [
						{
							name: 'backup-container',
							image: 'alpine',
							command: ['/bin/sh', '-c'],
							args: [
								`tar -czvf /backups/${backupFileName} -C /data world`,
							],
							volumeMounts: [
								{
									name: 'data-volume',
									mountPath: '/data',
									readOnly: true,
								},
								{
									name: 'backup-volume',
									mountPath: '/backups',
								},
							],
						},
					],
					volumes: [
						{
							name: 'data-volume',
							persistentVolumeClaim: {
								claimName: `${serverId}-pvc`,
							},
						},
						{
							name: 'backup-volume',
							persistentVolumeClaim: {
								claimName: 'global-backups-pvc',
							},
						},
					],
				},
			},
		};

		try {
			await this.k8sApi.createNamespacedJob(namespace, job);
			this.logger.log(
				`Created backup job ${jobName} for server ${serverId}`,
			);
		} catch (err) {
			const error = err as Error;
			this.logger.error(
				`Failed to create backup job for server ${serverId}: ${error.message}`,
			);
			throw error;
		}
	}
}
