const fs = require('fs');
const path = require('path');

function processDir(dir) {
	const files = fs.readdirSync(dir);
	for (const file of files) {
		const fullPath = path.join(dir, file);
		if (fs.statSync(fullPath).isDirectory()) {
			processDir(fullPath);
		} else if (fullPath.endsWith('.ts')) {
			let content = fs.readFileSync(fullPath, 'utf8');
			const original = content;

			// Fix catch (e: any)
			content = content.replace(
				/catch \(([^:]+): any\)/g,
				'catch ($1: unknown)',
			);

			// Fix gateway.service.ts
			if (fullPath.includes('gateway.service.ts')) {
				content = content.replace(
					/server\?: any/g,
					'server?: Record<string, unknown>',
				);
			}

			// Fix sleep-mode.service.ts
			if (fullPath.includes('sleep-mode.service.ts')) {
				content = content.replace(
					/d\.metadata\?\.name!/g,
					'd.metadata?.name as string',
				);
				content = content.replace(
					/this\.inactiveSince\.get\(serverId\)!/g,
					'this.inactiveSince.get(serverId) as Date',
				);
			}

			// Fix prisma.service.ts
			if (fullPath.includes('prisma.service.ts')) {
				content = content.replace(
					/constructor\(private readonly appConfig: AppConfigService\)/g,
					'constructor(readonly appConfig: AppConfigService)',
				);
			}

			// Fix tailscale.service.ts
			if (fullPath.includes('tailscale.service.ts')) {
				content = content.replace(
					/Promise<any\[\]>/g,
					'Promise<Record<string, unknown>[]>',
				);
				content = content.replace(
					/\(d: any\)/g,
					'(d: Record<string, unknown>)',
				);
				content = content.replace(/\(t: string\)/g, '(t: string)'); // Already ok, just for context
			}

			if (content !== original) {
				fs.writeFileSync(fullPath, content);
			}
		}
	}
}

processDir('dashboard/backend/src');
